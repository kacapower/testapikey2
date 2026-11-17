import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { AppError, ErrorCodes } from './errors.js';

// Strict memory cap enforcement for Sharp in 512 MB RAM environment
sharp.cache(false);
sharp.concurrency(1);

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

  updateProgress(40);

  let outputBuffer;
  let finalQuality = userQuality;
  let currentWidth = metadata.width;
  let currentHeight = metadata.height;

  // Apply dimension limits if specified
  let scaleFactor = 1;
  if (maxWidth && currentWidth > maxWidth) {
    scaleFactor = Math.min(scaleFactor, maxWidth / currentWidth);
  }
  if (maxHeight && currentHeight > maxHeight) {
    scaleFactor = Math.min(scaleFactor, maxHeight / currentHeight);
  }

  if (scaleFactor < 1) {
    currentWidth = Math.round(currentWidth * scaleFactor);
    currentHeight = Math.round(currentHeight * scaleFactor);
  }

  if (targetKb && targetKb > 0) {
    const targetBytes = targetKb * 1024;
    // Iterative binary search for quality to hit target file size
    let low = 10;
    let high = 95;
    let bestBuffer = null;
    let bestDiff = Infinity;

    for (let iter = 0; iter < 6; iter++) {
      const midQuality = Math.round((low + high) / 2);
      updateProgress(40 + iter * 8);

      const buf = await renderPipeline(filePath, outFormat, midQuality, currentWidth, currentHeight);
      const size = buf.length;

      if (size <= targetBytes) {
        bestBuffer = buf;
        finalQuality = midQuality;
        // Can we get better quality while staying under targetBytes?
        low = midQuality + 1;
      } else {
        high = midQuality - 1;
      }

      if (Math.abs(size - targetBytes) < targetBytes * 0.05) {
        // Within 5% tolerance
        bestBuffer = buf;
        finalQuality = midQuality;
        break;
      }
    }

    // If still over target after quality drop, downscale dimensions
    if (!bestBuffer || bestBuffer.length > targetBytes) {
      let dimScale = 0.85;
      for (let scaleIter = 0; scaleIter < 4; scaleIter++) {
        updateProgress(85 + scaleIter * 3);
        const w = Math.round(currentWidth * dimScale);
        const h = Math.round(currentHeight * dimScale);
        const buf = await renderPipeline(filePath, outFormat, Math.min(finalQuality, 75), w, h);
        if (buf.length <= targetBytes || scaleIter === 3) {
          bestBuffer = buf;
          currentWidth = w;
          currentHeight = h;
          break;
        }
        dimScale *= 0.8;
      }
    }

    outputBuffer = bestBuffer || (await renderPipeline(filePath, outFormat, 40, currentWidth, currentHeight));
  } else {
    // Normal quality / dimension compression
    updateProgress(60);
    outputBuffer = await renderPipeline(filePath, outFormat, userQuality, currentWidth, currentHeight);
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

async function renderPipeline(inputPath, format, quality, width, height) {
  let pipeline = sharp(inputPath, { failOnError: false });

  if (width && height) {
    pipeline = pipeline.resize(width, height, { fit: 'inside', withoutEnlargement: true });
  }

  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  } else if (format === 'png') {
    // Sharp PNG: compressionLevel 1-9, quality 1-100
    pipeline = pipeline.png({ compressionLevel: 8, quality });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality, effort: 4 });
  }

  return await pipeline.toBuffer();
}
