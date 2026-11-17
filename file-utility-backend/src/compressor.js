import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';
import { AppError, ErrorCodes } from './errors.js';

// Maximize compute power: multi-threading across all logical CPU cores + SIMD acceleration
const availableCpus = Math.max(1, os.cpus().length);
sharp.concurrency(availableCpus);
sharp.simd(true);
sharp.cache({ memory: 64, files: 0, items: 20 });

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export async function processImageCompression(payload, updateProgress) {
  const { filePath, originalName, mimeType, options = {} } = payload;

  if (!filePath) {
    throw new AppError(ErrorCodes.ERR_NO_FILE, 'No image file uploaded');
  }

  const ext = path.extname(originalName || '').toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(mimeType) && !ALLOWED_IMAGE_EXTS.has(ext)) {
    throw new AppError(
      ErrorCodes.ERR_UNSUPPORTED_FORMAT,
      `Unsupported image format (${mimeType || ext}). Only JPEG, PNG, and WEBP are supported.`
    );
  }

  updateProgress(20);

  let metadata;
  try {
    metadata = await sharp(filePath).metadata();
  } catch (err) {
    throw new AppError(
      ErrorCodes.ERR_CORRUPT_IMAGE,
      'Failed to decode image. The file may be corrupt or not a valid image.'
    );
  }

  const stat = await fs.stat(filePath);
  const originalSize = stat.size;

  const targetFormat = (options.format || 'original').toLowerCase();
  const format = targetFormat === 'original'
    ? (metadata.format === 'png' ? 'png' : metadata.format === 'webp' ? 'webp' : 'jpeg')
    : targetFormat;

  if (!['jpeg', 'jpg', 'png', 'webp'].includes(format)) {
    throw new AppError(
      ErrorCodes.ERR_UNSUPPORTED_FORMAT,
      `Unsupported output format: ${format}`
    );
  }

  const outFormat = format === 'jpg' ? 'jpeg' : format;
  const targetKb = options.targetKb ? parseFloat(options.targetKb) : null;
  const userQuality = options.quality ? parseInt(options.quality, 10) : 80;
  const maxWidth = options.maxWidth ? parseInt(options.maxWidth, 10) : null;
  const maxHeight = options.maxHeight ? parseInt(options.maxHeight, 10) : null;

  updateProgress(35);

  let outputBuffer;
  let finalQuality = userQuality;
  let currentWidth = metadata.width;
  let currentHeight = metadata.height;

  // Apply user dimension limits if specified
  let scaleFactor = 1;
  if (maxWidth && currentWidth > maxWidth) {
    scaleFactor = Math.min(scaleFactor, maxWidth / currentWidth);
  }
  if (maxHeight && currentHeight > maxHeight) {
    scaleFactor = Math.min(scaleFactor, maxHeight / currentHeight);
  }

  // Intelligent Pre-scaling for Target File Size:
  // If targetKb is small (e.g. <= 200 KB) and no explicit maxWidth/maxHeight is given,
  // clamp giant resolutions (24MP-50MP phone camera photos) to avoid mathematically impossible compression loops
  if (targetKb && targetKb > 0 && !maxWidth && !maxHeight) {
    let autoMaxDim = 4096;
    if (targetKb <= 100) autoMaxDim = 1920;
    else if (targetKb <= 300) autoMaxDim = 2560;
    else if (targetKb <= 800) autoMaxDim = 3200;

    const maxDim = Math.max(currentWidth, currentHeight);
    if (maxDim > autoMaxDim) {
      scaleFactor = Math.min(scaleFactor, autoMaxDim / maxDim);
    }
  }

  if (scaleFactor < 1) {
    currentWidth = Math.round(currentWidth * scaleFactor);
    currentHeight = Math.round(currentHeight * scaleFactor);
  }

  // Pre-load working image in memory (resized once, zero repeated disk reads!)
  let workingPipeline = sharp(filePath, { failOnError: false });
  if (currentWidth !== metadata.width || currentHeight !== metadata.height) {
    workingPipeline = workingPipeline.resize(currentWidth, currentHeight, { fit: 'inside', withoutEnlargement: true });
  }
  const workingBuffer = await workingPipeline.toBuffer();

  updateProgress(50);

  if (targetKb && targetKb > 0) {
    const targetBytes = targetKb * 1024;
    let low = 15;
    let high = 95;
    let bestBuffer = null;

    // 4 high-speed binary search iterations directly in RAM
    for (let iter = 0; iter < 4; iter++) {
      const midQuality = Math.round((low + high) / 2);
      updateProgress(50 + iter * 10);

      const buf = await renderPipelineFast(workingBuffer, outFormat, midQuality);
      const size = buf.length;

      if (size <= targetBytes) {
        bestBuffer = buf;
        finalQuality = midQuality;
        low = midQuality + 1;
      } else {
        high = midQuality - 1;
      }

      if (Math.abs(size - targetBytes) < targetBytes * 0.06) {
        bestBuffer = buf;
        finalQuality = midQuality;
        break;
      }
    }

    // If still over target after quality adjustments, apply quick 1-pass exact ratio downscale
    if (!bestBuffer || bestBuffer.length > targetBytes) {
      const currentLen = bestBuffer ? bestBuffer.length : (targetBytes * 1.5);
      const downScale = Math.max(0.35, Math.min(0.9, Math.sqrt(targetBytes / currentLen)));
      const newW = Math.round(currentWidth * downScale);
      const newH = Math.round(currentHeight * downScale);
      updateProgress(85);
      bestBuffer = await renderPipelineFast(workingBuffer, outFormat, Math.min(finalQuality, 75), newW, newH);
      currentWidth = newW;
      currentHeight = newH;
    }

    outputBuffer = bestBuffer || (await renderPipelineFast(workingBuffer, outFormat, 40, currentWidth, currentHeight));
  } else {
    // Normal quality / dimension compression
    updateProgress(75);
    outputBuffer = await renderPipelineFast(workingBuffer, outFormat, userQuality);
    finalQuality = userQuality;
  }

  updateProgress(90);

  const outExt = outFormat === 'jpeg' ? '.jpg' : `.${outFormat}`;
  const baseName = path.parse(originalName || 'compressed').name;
  const outFilename = `${baseName}_compressed${outExt}`;
  const outputPath = path.join(path.dirname(filePath), `out_${Date.now()}_${outFilename}`);

  await fs.writeFile(outputPath, outputBuffer);

  const resultSize = outputBuffer.length;
  const ratio = originalSize > 0
    ? `${Math.max(0, Math.round(((originalSize - resultSize) / originalSize) * 100))}%`
    : '0%';

  const mimeMap = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };

  return {
    outputPath,
    filename: outFilename,
    mimeType: mimeMap[outFormat] || 'application/octet-stream',
    meta: {
      originalSize,
      resultSize,
      savedBytes: Math.max(0, originalSize - resultSize),
      compressionRatio: ratio,
      format: outFormat,
      quality: finalQuality,
      width: currentWidth,
      height: currentHeight,
    },
  };
}

async function renderPipelineFast(inputBuffer, format, quality, width, height) {
  let pipeline = sharp(inputBuffer, { failOnError: false });

  if (width && height) {
    pipeline = pipeline.resize(width, height, { fit: 'inside', withoutEnlargement: true });
  }

  if (format === 'jpeg') {
    // Fast SIMD libjpeg-turbo with progressive rendering (10x faster than mozjpeg)
    pipeline = pipeline.jpeg({ quality, progressive: true, mozjpeg: false });
  } else if (format === 'png') {
    // Balanced fast PNG compression
    pipeline = pipeline.png({ compressionLevel: 6, quality });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality, effort: 3 });
  }

  return await pipeline.toBuffer();
}
