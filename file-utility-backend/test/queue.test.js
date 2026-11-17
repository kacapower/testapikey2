import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { JobQueue } from '../src/queue.js';
import { AppError, ErrorCodes } from '../src/errors.js';

test('JobQueue: Enqueues jobs, preserves FIFO order and enforces concurrency limit = 1', async () => {
  const tempDir = path.join(os.tmpdir(), `test_queue_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const queue = new JobQueue({
    maxConcurrentJobs: 1,
    maxQueueSize: 10,
    estimatedJobDurationSec: 5,
    fileRetentionMs: 1000,
    tempDir,
  });

  const executionLog = [];

  const createProcessor = (id, durationMs) => async (payload, updateProgress) => {
    executionLog.push(`start_${id}`);
    updateProgress(50);
    await new Promise((r) => setTimeout(r, durationMs));
    executionLog.push(`end_${id}`);
    return {
      outputPath: path.join(tempDir, `out_${id}.txt`),
      filename: `out_${id}.txt`,
      mimeType: 'text/plain',
      meta: { id },
    };
  };

  const job1 = queue.enqueue('task', { test: 1 }, createProcessor(1, 40));
  const job2 = queue.enqueue('task', { test: 2 }, createProcessor(2, 30));
  const job3 = queue.enqueue('task', { test: 3 }, createProcessor(3, 20));

  assert.strictEqual(job1.status, 'queued');
  assert.strictEqual(job2.status, 'queued');

  // Allow next tick for job 1 to start processing
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(queue.getStatus(job1.jobId).status, 'processing');
  assert.strictEqual(queue.getStatus(job2.jobId).position, 1);
  assert.strictEqual(queue.getStatus(job3.jobId).position, 2);

  // Wait for all to finish
  await new Promise((r) => setTimeout(r, 160));

  // Verify sequential execution
  assert.deepStrictEqual(executionLog, [
    'start_1',
    'end_1',
    'start_2',
    'end_2',
    'start_3',
    'end_3',
  ]);

  const status1 = queue.getStatus(job1.jobId);
  assert.strictEqual(status1.status, 'completed');
  assert.strictEqual(status1.progress, 100);
  assert.strictEqual(status1.downloadUrl, `/api/jobs/${job1.jobId}/download`);

  queue.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test('JobQueue: Calculates live queue position and estimated wait time correctly', async () => {
  const queue = new JobQueue({
    maxConcurrentJobs: 1,
    estimatedJobDurationSec: 10,
  });

  const resolvers = {};
  const createControllableProcessor = (id) => () =>
    new Promise((resolve) => {
      resolvers[id] = resolve;
    });

  const job1 = queue.enqueue('task', {}, createControllableProcessor(1));
  const job2 = queue.enqueue('task', {}, createControllableProcessor(2));
  const job3 = queue.enqueue('task', {}, createControllableProcessor(3));

  // Allow tick to start job1
  await new Promise((r) => setImmediate(r));

  const status2 = queue.getStatus(job2.jobId);
  assert.strictEqual(status2.status, 'queued');
  assert.strictEqual(status2.position, 1);
  assert.strictEqual(status2.estimatedWaitSeconds, 20); // (1 waiting + 1 active) * 10s

  const status3 = queue.getStatus(job3.jobId);
  assert.strictEqual(status3.status, 'queued');
  assert.strictEqual(status3.position, 2);
  assert.strictEqual(status3.estimatedWaitSeconds, 30); // (2 waiting + 1 active) * 10s

  // Resolve all jobs so queue empties cleanly
  resolvers[1]({ outputPath: null, filename: 'f1', mimeType: 'text/plain' });
  await new Promise((r) => setTimeout(r, 20));
  resolvers[2]({ outputPath: null, filename: 'f2', mimeType: 'text/plain' });
  await new Promise((r) => setTimeout(r, 20));
  resolvers[3]({ outputPath: null, filename: 'f3', mimeType: 'text/plain' });
  await new Promise((r) => setTimeout(r, 20));

  queue.shutdown();
});

test('JobQueue: Rejects when max queue capacity is exceeded', () => {
  const queue = new JobQueue({
    maxConcurrentJobs: 1,
    maxQueueSize: 2,
  });

  const noop = () => new Promise(() => {});

  queue.enqueue('t1', {}, noop);
  queue.enqueue('t2', {}, noop);

  assert.throws(
    () => queue.enqueue('t3', {}, noop),
    (err) => err instanceof AppError && err.code === ErrorCodes.ERR_QUEUE_FULL
  );

  queue.shutdown();
});
