import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { AppError, ErrorCodes } from './errors.js';
import { JobQueue } from './queue.js';
import { processImageCompression } from './compressor.js';
import { processPdfConversion } from './pdf-converter.js';

export function createServer(customConfig = null) {
  const config = customConfig || loadConfig();
  const app = express();
  const queue = new JobQueue(config);

  // Multer disk storage streaming directly to temp directory to avoid RAM spikes
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, config.tempDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `upload_${uniqueSuffix}_${safeName}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: config.maxFileSizeBytes, // 25 MB
      files: 1,
    },
  });

  // CORS Configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Support subdomain wildcard matching e.g. *.epizy.com
        const isAllowedWildcard = config.allowedOrigins.some((pattern) => {
          if (pattern.startsWith('*.')) {
            const domain = pattern.slice(2);
            return origin.endsWith(domain);
          }
          return false;
        });
        if (isAllowedWildcard) return callback(null, true);

        callback(null, true); // Allow all in permissive mode for free static clients
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['Content-Disposition'],
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Cold-Start & Health Check Endpoint
  app.get('/api/health', (req, res) => {
    const mem = process.memoryUsage();
    const metrics = queue.getMetrics();

    res.json({
      status: 'ok',
      service: 'render-file-utility',
      queueLength: metrics.queuedJobs,
      activeJobs: metrics.activeJobs,
      concurrencyLimit: metrics.concurrencyLimit,
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Tool 1: Image Compression Endpoint
  app.post('/api/compress-image', upload.single('file'), (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError(ErrorCodes.ERR_NO_FILE, 'No file was provided in the request payload');
      }

      const payload = {
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        options: {
          targetKb: req.body.targetKb,
          quality: req.body.quality,
          format: req.body.format,
          maxWidth: req.body.maxWidth,
          maxHeight: req.body.maxHeight,
        },
      };

      const result = queue.enqueue('compress-image', payload, processImageCompression);
      res.status(202).json({
        success: true,
        ...result,
      });
    } catch (err) {
      // Clean up uploaded file if queue reject or early validation error
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      next(err);
    }
  });

  // Tool 2: PDF to Image Converter Endpoint
  app.post('/api/pdf-to-image', upload.single('file'), (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError(ErrorCodes.ERR_NO_FILE, 'No PDF file was provided in the request payload');
      }

      const payload = {
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        options: {
          format: req.body.format,
          dpi: req.body.dpi,
          pages: req.body.pages,
        },
      };

      const result = queue.enqueue('pdf-to-image', payload, processPdfConversion);
      res.status(202).json({
        success: true,
        ...result,
      });
    } catch (err) {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
      next(err);
    }
  });

  // Job Status Polling Endpoint
  app.get('/api/jobs/:jobId/status', (req, res, next) => {
    try {
      const status = queue.getStatus(req.params.jobId);
      res.json({
        success: true,
        ...status,
      });
    } catch (err) {
      next(err);
    }
  });

  // Secure File Download Endpoint
  app.get('/api/jobs/:jobId/download', (req, res, next) => {
    try {
      const job = queue.getJob(req.params.jobId);
      if (!job || job.status !== 'completed' || !job.resultPath) {
        throw new AppError(
          ErrorCodes.ERR_JOB_NOT_FOUND,
          'Requested download file is not available, already purged, or does not exist.',
          404
        );
      }

      if (!fs.existsSync(job.resultPath)) {
        throw new AppError(
          ErrorCodes.ERR_JOB_EXPIRED,
          'The file download window has expired and the file has been purged from memory/disk.',
          410
        );
      }

      res.setHeader('Content-Type', job.resultMime || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(job.resultFilename || 'download')}"`
      );

      const fileStream = fs.createReadStream(job.resultPath);
      fileStream.pipe(res);

      res.on('finish', () => {
        queue.onDownloadComplete(job.jobId);
      });

      fileStream.on('error', (err) => {
        next(err);
      });
    } catch (err) {
      next(err);
    }
  });

  // Global Error Handler
  app.use((err, req, res, next) => {
    // Multer upload errors
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: {
            code: ErrorCodes.ERR_FILE_TOO_LARGE,
            message: `File exceeds maximum allowed size of ${config.maxFileSizeMb} MB.`,
          },
        });
      }
      return res.status(400).json({
        success: false,
        error: {
          code: 'ERR_UPLOAD_ERROR',
          message: err.message,
        },
      });
    }

    // Custom AppErrors
    if (err instanceof AppError) {
      return res.status(err.status).json(err.toJSON());
    }

    console.error('[file-utility-error]', err);
    return res.status(500).json({
      success: false,
      error: {
        code: ErrorCodes.ERR_INTERNAL,
        message: 'Internal server processing error occurred.',
      },
    });
  });

  return { app, queue, config };
}

// Direct execution entrypoint
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const { app, config } = createServer();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[file-utility-backend] Server listening on port ${config.port} (env: ${config.nodeEnv})`);
    console.log(`[file-utility-backend] Concurrency limit: ${config.maxConcurrentJobs} job(s)`);
    console.log(`[file-utility-backend] Temp directory: ${config.tempDir}`);
  });

  const shutdown = () => {
    console.log('[file-utility-backend] Shutting down gracefully...');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
