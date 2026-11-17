import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createServer } from '../src/server.js';

async function testLiveSupabaseIntegration() {
  console.log('--- STARTING LIVE SUPABASE E2E INTEGRATION TEST ---');

  const supabaseUrl = process.env.SUPABASE_URL || 'https://ggxsinemrhhhxhviylig.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseBucket = process.env.SUPABASE_BUCKET || 'file-utility-temp';

  if (!supabaseServiceKey) {
    console.log('[E2E-Supabase] Skipping live cloud test: SUPABASE_SERVICE_ROLE_KEY not set in env');
    return;
  }

  const tempDir = path.join(os.tmpdir(), `supabase_e2e_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const { app, queue, supabaseStorage } = createServer({
    port: 0,
    tempDir,
    allowedOrigins: ['*'],
    maxConcurrentJobs: 1,
    fileRetentionMs: 15000,
    supabaseUrl,
    supabaseServiceKey,
    supabaseBucket,
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[E2E-Supabase] Test server running on ${baseUrl}`);

  try {
    // 1. Health check verifies Supabase is configured
    console.log('[E2E-Supabase] 1. Verifying /api/health with supabaseConfigured...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const healthData = await healthRes.json();
    console.log('[E2E-Supabase] Health:', healthData);
    if (!healthData.supabaseConfigured) {
      throw new Error('Expected supabaseConfigured: true in health check');
    }

    // 2. Generate random test image
    console.log('[E2E-Supabase] 2. Generating random test JPEG...');
    const rawBuffer = Buffer.alloc(300 * 300 * 3);
    for (let i = 0; i < rawBuffer.length; i++) rawBuffer[i] = Math.floor(Math.random() * 256);
    const jpegBuffer = await sharp(rawBuffer, { raw: { width: 300, height: 300, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    console.log(`[E2E-Supabase] Generated test JPEG: ${jpegBuffer.length} bytes`);

    // 3. Submit to /api/compress-image
    console.log('[E2E-Supabase] 3. Submitting image to /api/compress-image...');
    const fd = new FormData();
    fd.append('file', new Blob([jpegBuffer], { type: 'image/jpeg' }), 'e2e_photo.jpg');
    fd.append('targetKb', '30');

    const submitRes = await fetch(`${baseUrl}/api/compress-image`, { method: 'POST', body: fd });
    const submitData = await submitRes.json();
    console.log('[E2E-Supabase] Submission response:', submitData);

    const jobId = submitData.jobId;

    // 4. Poll status
    console.log(`[E2E-Supabase] 4. Polling status for jobId ${jobId}...`);
    let completedStatus = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const stRes = await fetch(`${baseUrl}/api/jobs/${jobId}/status`);
      const st = await stRes.json();
      console.log(`[E2E-Supabase] Poll #${i}: status=${st.status}, progress=${st.progress}`);
      if (st.status === 'completed') {
        completedStatus = st;
        break;
      }
    }

    if (!completedStatus) throw new Error('Job did not complete in time');

    console.log('[E2E-Supabase] Job completed successfully!');
    console.log('[E2E-Supabase] Completed data:', completedStatus);

    if (completedStatus.storage !== 'supabase') {
      throw new Error(`Expected storage="supabase", got "${completedStatus.storage}"`);
    }

    if (!completedStatus.downloadUrl.includes('supabase.co')) {
      throw new Error(`Expected downloadUrl from supabase.co, got "${completedStatus.downloadUrl}"`);
    }

    // 5. Verify local file on Render was IMMEDIATELY purged
    const job = queue.getJob(jobId);
    console.log('[E2E-Supabase] 5. Verifying Render local resultPath is nullified...');
    if (job.resultPath !== null) {
      throw new Error(`Expected job.resultPath to be null, got "${job.resultPath}"`);
    }
    console.log('✅ PASS: Render local disk purged immediately upon push to Supabase!');

    // 6. Direct client download from Supabase Storage
    console.log('[E2E-Supabase] 6. Downloading file directly from Supabase Storage URL...');
    const supabaseDownloadRes = await fetch(completedStatus.downloadUrl);
    console.log(`[E2E-Supabase] Supabase download HTTP status: ${supabaseDownloadRes.status}`);
    if (!supabaseDownloadRes.ok) {
      throw new Error(`Failed to download from Supabase: HTTP ${supabaseDownloadRes.status}`);
    }

    const downloadedBytes = await supabaseDownloadRes.arrayBuffer();
    console.log(`[E2E-Supabase] Downloaded ${downloadedBytes.byteLength} bytes directly from Supabase!`);
    if (downloadedBytes.byteLength < 500) {
      throw new Error('Downloaded file unexpectedly small');
    }
    console.log('✅ PASS: Direct client download from Supabase succeeded!');

    // Clean up uploaded object
    if (job.supabase?.objectPath) {
      await supabaseStorage.deleteObject(job.supabase.objectPath);
      console.log(`[E2E-Supabase] Cleaned up Supabase object: ${job.supabase.objectPath}`);
    }

    console.log('\n🎉 ALL LIVE SUPABASE INTEGRATION CHECKS PASSED 100%! 🚀');
  } finally {
    queue.shutdown();
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

testLiveSupabaseIntegration().catch((err) => {
  console.error('[E2E-Supabase FAILED]:', err);
  process.exit(1);
});
