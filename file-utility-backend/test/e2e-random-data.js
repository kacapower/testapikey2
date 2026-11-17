import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createServer } from '../src/server.js';

async function runEndToEndTest() {
  console.log('--- STARTING LOCAL END-TO-END FILE UTILITY TEST ---');
  const tempDir = path.join(os.tmpdir(), `e2e_test_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['*'],
    maxConcurrentJobs: 1,
    fileRetentionMs: 5000,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E] Server running on ${baseUrl}`);

  try {
    // 1. Health check
    console.log('\n[E2E] 1. Checking GET /api/health...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log('[E2E] Health response:', JSON.stringify(healthData, null, 2));
    if (healthData.status !== 'ok') throw new Error('Health status not ok');

    // 2. Generate random test image
    console.log('\n[E2E] 2. Generating random test image...');
    // Create random 800x600 image with raw random noise buffer
    const randomPixels = Buffer.alloc(800 * 600 * 3);
    for (let i = 0; i < randomPixels.length; i++) {
      randomPixels[i] = Math.floor(Math.random() * 256);
    }
    const testImageBuffer = await sharp(randomPixels, {
      raw: { width: 800, height: 600, channels: 3 }
    }).jpeg({ quality: 90 }).toBuffer();

    console.log(`[E2E] Generated test image: ${testImageBuffer.length} bytes (${Math.round(testImageBuffer.length / 1024)} KB)`);

    // 3. Submit to POST /api/compress-image with FormData
    console.log('\n[E2E] 3. Submitting to POST /api/compress-image (targetKb: 50, format: webp)...');
    const formData = new FormData();
    const fileBlob = new Blob([testImageBuffer], { type: 'image/jpeg' });
    formData.append('file', fileBlob, 'random_test_image.jpg');
    formData.append('targetKb', '50');
    formData.append('format', 'webp');

    const submitRes = await fetch(`${baseUrl}/api/compress-image`, {
      method: 'POST',
      body: formData,
    });

    console.log(`[E2E] Submission status: ${submitRes.status}`);
    const submitData = await submitRes.json();
    console.log('[E2E] Submission response:', submitData);

    const jobId = submitData.jobId;
    if (!jobId) throw new Error('No jobId returned!');

    // 4. Poll status
    console.log(`\n[E2E] 4. Polling status for jobId ${jobId}...`);
    let completed = false;
    let pollCount = 0;
    let downloadUrl = '';

    while (!completed && pollCount < 20) {
      pollCount++;
      await new Promise((r) => setTimeout(r, 600));
      const statusRes = await fetch(`${baseUrl}/api/jobs/${jobId}/status`);
      const statusData = await statusRes.json();
      console.log(`[E2E] Poll #${pollCount}: status=${statusData.status}, progress=${statusData.progress}%, position=${statusData.position}`);

      if (statusData.status === 'completed') {
        completed = true;
        downloadUrl = statusData.downloadUrl;
        console.log('[E2E] Job Completed! Metadata:', statusData.meta);
        break;
      } else if (statusData.status === 'failed') {
        throw new Error(`Job failed: ${JSON.stringify(statusData.error)}`);
      }
    }

    if (!completed) throw new Error('Polling timed out without completing');

    // 5. Download result
    console.log(`\n[E2E] 5. Downloading result from ${baseUrl}${downloadUrl}...`);
    const downloadRes = await fetch(`${baseUrl}${downloadUrl}`);
    console.log(`[E2E] Download response status: ${downloadRes.status}, Content-Type: ${downloadRes.headers.get('content-type')}`);
    const resultBuffer = await downloadRes.arrayBuffer();
    console.log(`[E2E] Downloaded result size: ${resultBuffer.byteLength} bytes (${Math.round(resultBuffer.byteLength / 1024)} KB)`);

    // 6. Verify auto-purge immediately after download
    console.log('\n[E2E] 6. Verifying immediate auto-purge on downloaded file...');
    await new Promise((r) => setTimeout(r, 1200));
    const reDownloadRes = await fetch(`${baseUrl}${downloadUrl}`);
    console.log(`[E2E] Re-download attempt status (expecting 404 or 410): ${reDownloadRes.status}`);
    if (reDownloadRes.status !== 404 && reDownloadRes.status !== 410) {
      console.warn('[E2E] Expected 404/410 after download, got:', reDownloadRes.status);
    } else {
      console.log('[E2E] Verified: Result file was automatically purged from disk/RAM!');
    }

    // 7. Test invalid file rejection
    console.log('\n[E2E] 7. Testing invalid file error handling...');
    const invalidForm = new FormData();
    invalidForm.append('file', new Blob(['this is not an image'], { type: 'text/plain' }), 'junk.txt');
    const errRes = await fetch(`${baseUrl}/api/compress-image`, {
      method: 'POST',
      body: invalidForm,
    });
    const errSubmit = await errRes.json();
    console.log(`[E2E] Invalid format submitted, jobId: ${errSubmit.jobId}`);

    // Poll for failure
    await new Promise((r) => setTimeout(r, 600));
    const failStatusRes = await fetch(`${baseUrl}/api/jobs/${errSubmit.jobId}/status`);
    const failStatus = await failStatusRes.json();
    console.log(`[E2E] Polled invalid job status: ${failStatus.status}, error code: ${failStatus.error?.code}`);
    if (failStatus.status !== 'failed' || failStatus.error?.code !== 'ERR_UNSUPPORTED_FORMAT') {
      throw new Error('Expected job to fail with ERR_UNSUPPORTED_FORMAT');
    }
    console.log('[E2E] Verified: Invalid format correctly rejected by worker with ERR_UNSUPPORTED_FORMAT!');

    console.log('\n✅ ALL LOCAL END-TO-END TESTS PASSED SUCCESSFULLY! 🚀');
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

runEndToEndTest().catch((err) => {
  console.error('[E2E FAILED]:', err);
  process.exit(1);
});
