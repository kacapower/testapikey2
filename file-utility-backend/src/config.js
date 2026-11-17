import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function loadConfig() {
  const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || '*';
  const allowedOrigins = allowedOriginsRaw.split(',').map((o) => o.trim()).filter(Boolean);

  const tempDir = process.env.TEMP_DIR || path.join(os.tmpdir(), 'file-utility');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    allowedOrigins,
    maxConcurrentJobs: Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10)),
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '50', 10),
    estimatedJobDurationSec: parseInt(process.env.ESTIMATED_JOB_DURATION_SEC || '8', 10),
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10),
    maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_MB || '25', 10) * 1024 * 1024,
    tempDir,
    fileRetentionMs: parseInt(process.env.FILE_RETENTION_MS || '300000', 10), // 5 minutes
    jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '90000', 10),       // 90 seconds max runtime
    sweepIntervalMs: parseInt(process.env.SWEEP_INTERVAL_MS || '120000', 10), // 2 minutes
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    supabaseBucket: process.env.SUPABASE_BUCKET || 'file-utility-temp',
  };
}
