import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { AppError, ErrorCodes } from './errors.js';

export class JobQueue {
  constructor(config = {}) {
    this.concurrency = config.maxConcurrentJobs || 1;
    this.maxQueueSize = config.maxQueueSize || 50;
    this.estimatedJobDurationSec = config.estimatedJobDurationSec || 8;
    this.fileRetentionMs = config.fileRetentionMs || 300000; // 5 min
    this.jobTimeoutMs = config.jobTimeoutMs || 90000;
    this.tempDir = config.tempDir;

    this.queue = [];             // FIFO array of jobIds waiting
    this.active = new Map();     // jobId -> Job
    this.completed = new Map();  // jobId -> Job
    this.timers = new Map();     // jobId -> retention setTimeout handle

    // Start background cleaner
    if (config.sweepIntervalMs) {
      this.sweepInterval = setInterval(() => this.sweepStaleFiles(), config.sweepIntervalMs);
      if (this.sweepInterval.unref) this.sweepInterval.unref();
    }
  }

  enqueue(type, payload, processor) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new AppError(
        ErrorCodes.ERR_QUEUE_FULL,
        'Server queue is at maximum capacity. Please wait a moment and try again.',
        503
      );
    }

    const jobId = crypto.randomUUID();
    const job = {
      jobId,
      type,
      payload,
      processor,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      resultPath: null,
      resultMime: null,
      resultFilename: null,
      meta: null,
      error: null,
      downloadCount: 0,
    };

    this.queue.push(jobId);
    this.active.set(jobId, job);

    // Schedule queue tick
    setImmediate(() => this.processNext());

    const position = this.getQueuePosition(jobId);
    return {
      jobId,
      status: job.status,
      position,
      estimatedWaitSeconds: position * this.estimatedJobDurationSec,
    };
  }

  getQueuePosition(jobId) {
    const idx = this.queue.indexOf(jobId);
    return idx === -1 ? 0 : idx + 1;
  }

  getJob(jobId) {
    return this.active.get(jobId) || this.completed.get(jobId) || null;
  }

  getStatus(jobId) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new AppError(ErrorCodes.ERR_JOB_NOT_FOUND, 'Job not found or expired', 404);
    }

    const base = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
    };

    if (job.status === 'queued') {
      const position = this.getQueuePosition(jobId);
      return {
        ...base,
        position,
        estimatedWaitSeconds: Math.max(1, (position + this.getActiveCount()) * this.estimatedJobDurationSec),
      };
    }

    if (job.status === 'processing') {
      return {
        ...base,
        position: 0,
        estimatedWaitSeconds: Math.max(1, Math.round(this.estimatedJobDurationSec * (1 - job.progress / 100))),
      };
    }

    if (job.status === 'completed') {
      const remainingMs = Math.max(0, (job.completedAt + this.fileRetentionMs) - Date.now());
      return {
        ...base,
        status: 'completed',
        progress: 100,
        downloadUrl: `/api/jobs/${job.jobId}/download`,
        expiresInSeconds: Math.round(remainingMs / 1000),
        meta: job.meta || {},
      };
    }

    if (job.status === 'failed') {
      return {
        ...base,
        status: 'failed',
        error: job.error,
      };
    }

    return base;
  }

  getActiveCount() {
    let count = 0;
    for (const job of this.active.values()) {
      if (job.status === 'processing') count++;
    }
    return count;
  }

  async processNext() {
    if (this.getActiveCount() >= this.concurrency) return;
    if (this.queue.length === 0) return;

    const nextJobId = this.queue.shift();
    const job = this.active.get(nextJobId);
    if (!job) return;

    job.status = 'processing';
    job.startedAt = Date.now();
    job.progress = 10;

    // Timeout watchdog
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      job.status = 'failed';
      job.error = {
        code: ErrorCodes.ERR_TIMEOUT,
        message: 'Job processing exceeded maximum allowed time limit.',
      };
      this.cleanupJobSource(job);
      this.moveToCompleted(job);
      this.processNext();
    }, this.jobTimeoutMs);
    if (timeoutHandle.unref) timeoutHandle.unref();

    try {
      const updateProgress = (pct) => {
        if (!timedOut) job.progress = Math.min(99, Math.max(job.progress, Math.round(pct)));
      };

      const result = await job.processor(job.payload, updateProgress);
      if (timedOut) return;

      clearTimeout(timeoutHandle);
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = Date.now();
      job.resultPath = result.outputPath;
      job.resultMime = result.mimeType;
      job.resultFilename = result.filename;
      job.meta = result.meta || {};

      // Purge uploaded input temp file immediately after successful processing
      await this.cleanupJobSource(job);

      // Move from active to completed
      this.moveToCompleted(job);

      // Schedule 5-minute auto-purge timer
      const retentionTimer = setTimeout(() => {
        this.purgeJobFiles(job.jobId);
      }, this.fileRetentionMs);
      if (retentionTimer.unref) retentionTimer.unref();
      this.timers.set(job.jobId, retentionTimer);

    } catch (err) {
      if (timedOut) return;
      clearTimeout(timeoutHandle);

      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = {
        code: err.code || ErrorCodes.ERR_PROCESSING_FAILED,
        message: err.message || 'An unexpected error occurred while processing the file.',
      };

      await this.cleanupJobSource(job);
      this.moveToCompleted(job);
    } finally {
      // Free slot for next queued job
      setImmediate(() => this.processNext());
    }
  }

  moveToCompleted(job) {
    this.active.delete(job.jobId);
    this.completed.set(job.jobId, job);
  }

  async cleanupJobSource(job) {
    if (job.payload?.filePath) {
      try {
        await fs.unlink(job.payload.filePath);
      } catch (_) {}
    }
  }

  async purgeJobFiles(jobId) {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }

    const job = this.getJob(jobId);
    if (!job) return;

    if (job.resultPath) {
      try {
        await fs.unlink(job.resultPath);
      } catch (_) {}
      job.resultPath = null;
    }

    this.active.delete(jobId);
    this.completed.delete(jobId);
  }

  async onDownloadComplete(jobId) {
    const job = this.completed.get(jobId);
    if (job) {
      job.downloadCount = (job.downloadCount || 0) + 1;
      // Immediate file purge after successful download delivery
      setTimeout(() => {
        this.purgeJobFiles(jobId);
      }, 1000);
    }
  }

  async sweepStaleFiles() {
    if (!this.tempDir || !fsSync.existsSync(this.tempDir)) return;
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      for (const file of files) {
        const fullPath = path.join(this.tempDir, file);
        try {
          const stats = await fs.stat(fullPath);
          // Delete files older than 10 minutes
          if (now - stats.mtimeMs > 600000) {
            await fs.rm(fullPath, { recursive: true, force: true });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  getMetrics() {
    return {
      queuedJobs: this.queue.length,
      activeJobs: this.getActiveCount(),
      completedJobs: this.completed.size,
      concurrencyLimit: this.concurrency,
    };
  }

  shutdown() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
