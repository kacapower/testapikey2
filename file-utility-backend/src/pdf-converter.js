import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import archiver from 'archiver';
import sharp from 'sharp';
import { AppError, ErrorCodes } from './errors.js';

const execFileAsync = promisify(execFile);

export async function processPdfConversion(payload, updateProgress) {
  const { filePath, originalName, mimeType, options = {} } = payload;

  if (!filePath) {
    throw new AppError(ErrorCodes.ERR_NO_FILE, 'No PDF file uploaded');
  }

  // Validate PDF magic bytes (%PDF-)
  const handle = await fs.open(filePath, 'r');
  const headerBuf = Buffer.alloc(5);
  await handle.read(headerBuf, 0, 5, 0);
  await handle.close();

  if (headerBuf.toString('utf-8') !== '%PDF-') {
    throw new AppError(
      ErrorCodes.ERR_CORRUPT_PDF,
      'The uploaded file is not a valid PDF document or header is missing.'
    );
  }

  updateProgress(15);

  const format = (options.format || 'jpg').toLowerCase();
  const validFormats = ['jpg', 'jpeg', 'png', 'webp'];
  if (!validFormats.includes(format)) {
    throw new AppError(
      ErrorCodes.ERR_UNSUPPORTED_FORMAT,
      `Unsupported output format: ${format}. Allowed: jpg, png, webp`
    );
  }

  const dpi = Math.min(300, Math.max(72, parseInt(options.dpi || '150', 10)));
  const pageOption = (options.pages || 'all').toString().trim().toLowerCase();

  // Create isolated temp working directory for this conversion
  const jobTempDir = path.join(path.dirname(filePath), `pdf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  await fs.mkdir(jobTempDir, { recursive: true });

  const prefix = path.join(jobTempDir, 'page');

  // Build pdftoppm args
  const args = ['-r', dpi.toString()];

  // Format flag: pdftoppm supports -png, -jpeg
  const intermediateFormat = (format === 'webp') ? 'png' : (format === 'png' ? 'png' : 'jpeg');
  if (intermediateFormat === 'png') {
    args.push('-png');
  } else {
    args.push('-jpeg');
  }

  // Page range flags: -f (first) and -l (last)
  if (pageOption !== 'all') {
    if (pageOption.includes('-')) {
      const [first, last] = pageOption.split('-').map((s) => parseInt(s.trim(), 10));
      if (!isNaN(first)) args.push('-f', first.toString());
      if (!isNaN(last)) args.push('-l', last.toString());
    } else {
      const pageNum = parseInt(pageOption, 10);
      if (!isNaN(pageNum)) {
        args.push('-f', pageNum.toString(), '-l', pageNum.toString());
      }
    }
  }

  args.push(filePath, prefix);

  updateProgress(35);

  try {
    // Run pdftoppm in an isolated subprocess with 60s timeout and memory limit
    await execFileAsync('pdftoppm', args, {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    // Clean up temp dir
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});

    if (err.killed || err.signal === 'SIGTERM') {
      throw new AppError(ErrorCodes.ERR_TIMEOUT, 'PDF conversion timed out (60s limit).');
    }
    throw new AppError(
      ErrorCodes.ERR_CORRUPT_PDF,
      `Failed to parse PDF document. It may be encrypted or corrupted: ${err.message}`
    );
  }

  updateProgress(65);

  // Read generated image files
  const files = await fs.readdir(jobTempDir);
  let imageFiles = files
    .filter((f) => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')))
    .sort();

  if (imageFiles.length === 0) {
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
    throw new AppError(ErrorCodes.ERR_CORRUPT_PDF, 'No pages could be extracted from the PDF.');
  }

  // If user requested WebP, convert intermediate files sequentially to save RAM
  if (format === 'webp') {
    const webpFiles = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const imgFile = imageFiles[i];
      const srcPath = path.join(jobTempDir, imgFile);
      const webpName = `${path.parse(imgFile).name}.webp`;
      const webpPath = path.join(jobTempDir, webpName);

      await sharp(srcPath).webp({ quality: 85 }).toFile(webpPath);
      await fs.unlink(srcPath).catch(() => {});
      webpFiles.push(webpName);
      updateProgress(65 + Math.round((i / imageFiles.length) * 20));
    }
    imageFiles = webpFiles;
  }

  const baseName = path.parse(originalName || 'document').name;

  // Single page result: direct image delivery
  if (imageFiles.length === 1) {
    updateProgress(95);
    const singleImageName = imageFiles[0];
    const singleImagePath = path.join(jobTempDir, singleImageName);
    const outFilename = `${baseName}_page1.${format === 'jpeg' ? 'jpg' : format}`;
    const finalOutputPath = path.join(path.dirname(filePath), `out_${Date.now()}_${outFilename}`);

    await fs.copyFile(singleImagePath, finalOutputPath);
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});

    const stat = await fs.stat(finalOutputPath);
    const mimeMap = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };

    return {
      outputPath: finalOutputPath,
      filename: outFilename,
      mimeType: mimeMap[format] || 'image/jpeg',
      meta: {
        pagesCount: 1,
        format,
        dpi,
        isZip: false,
        resultSize: stat.size,
      },
    };
  }

  // Multi-page result: package into a single .zip file
  updateProgress(80);
  const zipFilename = `${baseName}_pages_${imageFiles.length}.${format}.zip`;
  const zipOutputPath = path.join(path.dirname(filePath), `out_${Date.now()}_${zipFilename}`);

  await createZipArchive(jobTempDir, imageFiles, zipOutputPath, (pct) => {
    updateProgress(80 + Math.round(pct * 0.18));
  });

  await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
  const zipStat = await fs.stat(zipOutputPath);

  return {
    outputPath: zipOutputPath,
    filename: zipFilename,
    mimeType: 'application/zip',
    meta: {
      pagesCount: imageFiles.length,
      format,
      dpi,
      isZip: true,
      resultSize: zipStat.size,
    },
  };
}

function createZipArchive(sourceDir, fileList, outputZipPath, onProgress) {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.on('progress', (data) => {
      if (data.entries.total > 0 && onProgress) {
        onProgress(data.entries.processed / data.entries.total);
      }
    });

    archive.pipe(output);

    for (const fileName of fileList) {
      archive.file(path.join(sourceDir, fileName), { name: fileName });
    }

    archive.finalize();
  });
}
