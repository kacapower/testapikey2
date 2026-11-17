import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { ErrorCodes } from '../src/errors.js';

test('API Endpoints: /api/health returns cold-start ready status and queue telemetry', async () => {
  const tempDir = path.join(os.tmpdir(), `test_api_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['*'],
    maxConcurrentJobs: 1,
    maxQueueSize: 50,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.service, 'render-file-utility');
    assert.strictEqual(typeof data.queueLength, 'number');
    assert.strictEqual(typeof data.activeJobs, 'number');
    assert.strictEqual(typeof data.memory.rssMb, 'number');
    assert.strictEqual(typeof data.memory.heapUsedMb, 'number');
    assert.strictEqual(typeof data.uptime, 'number');
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('API Endpoints: CORS headers allow cross-origin requests from frontend', async () => {
  const tempDir = path.join(os.tmpdir(), `test_cors_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['https://user.epizy.com'],
    maxConcurrentJobs: 1,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://user.epizy.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://user.epizy.com');
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('API Endpoints: Returns ERR_NO_FILE on empty POST submission', async () => {
  const tempDir = path.join(os.tmpdir(), `test_err_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['*'],
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/compress-image`, {
      method: 'POST',
      body: new FormData(), // empty form data
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.error.code, ErrorCodes.ERR_NO_FILE);
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('API Endpoints: Returns ERR_JOB_NOT_FOUND on non-existent jobId', async () => {
  const tempDir = path.join(os.tmpdir(), `test_notfound_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['*'],
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/non-existent-id/status`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.error.code, ErrorCodes.ERR_JOB_NOT_FOUND);
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});
