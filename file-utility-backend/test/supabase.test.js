import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JobQueue } from '../src/queue.js';
import { SupabaseStorage } from '../src/supabase.js';

describe('Supabase Storage Integration & Memory/Disk Purge', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `supabase_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Immediate Supabase upload, immediate local disk purge, and 5-min TTL tracking', async () => {
    let uploadedObjectPath = null;
    let deletedObjectPath = null;

    // Mock SupabaseStorage client
    const mockSupabaseStorage = {
      isConfigured: () => true,
      bucket: 'test-bucket',
      uploadFile: async (objectPath, filePath, mimeType) => {
        uploadedObjectPath = objectPath;
        // Verify file exists at the moment of upload
        const existsBefore = await fs.access(filePath).then(() => true).catch(() => false);
        assert.equal(existsBefore, true, 'Processed file should exist before upload');

        return {
          bucket: 'test-bucket',
          objectPath,
          signedUrl: `https://mock.supabase.co/storage/v1/object/sign/test-bucket/${objectPath}?token=abc`,
          publicUrl: `https://mock.supabase.co/storage/v1/object/public/test-bucket/${objectPath}`,
        };
      },
      deleteObject: async (objectPath) => {
        deletedObjectPath = objectPath;
        return true;
      },
    };

    const queue = new JobQueue({
      tempDir,
      maxConcurrentJobs: 1,
      fileRetentionMs: 50, // fast TTL for test
      supabaseStorage: mockSupabaseStorage,
    });

    // Create synthetic input and output files
    const inputPath = path.join(tempDir, 'sample_input.jpg');
    const outputPath = path.join(tempDir, 'sample_out.jpg');
    await fs.writeFile(inputPath, 'dummy image input');
    await fs.writeFile(outputPath, 'compressed image content');

    const mockProcessor = async () => {
      return {
        outputPath,
        filename: 'result.jpg',
        mimeType: 'image/jpeg',
        meta: { compressionRatio: '45%' },
      };
    };

    const enq = queue.enqueue('compress-image', { filePath: inputPath }, mockProcessor);
    assert.equal(enq.status, 'queued');

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 30));

    const status = queue.getStatus(enq.jobId);
    assert.equal(status.status, 'completed');
    assert.equal(status.storage, 'supabase');
    assert.match(status.downloadUrl, /mock\.supabase\.co/);
    assert.equal(uploadedObjectPath, `processed/${enq.jobId}/result.jpg`);

    // Verify local output file on Render was IMMEDIATELY purged from disk
    const existsAfter = await fs.access(outputPath).then(() => true).catch(() => false);
    assert.equal(existsAfter, false, 'Render local processed file must be IMMEDIATELY deleted upon Supabase upload');

    const job = queue.getJob(enq.jobId);
    assert.equal(job.resultPath, null, 'job.resultPath must be nullified to prevent stale disk references');

    // Wait for 5-minute (mocked to 50ms) retention timer to fire
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(deletedObjectPath, `processed/${enq.jobId}/result.jpg`, 'Supabase object must be deleted when TTL expires');

    queue.shutdown();
  });
});
