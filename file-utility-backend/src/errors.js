export class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const ErrorCodes = {
  ERR_FILE_TOO_LARGE: 'ERR_FILE_TOO_LARGE',
  ERR_NO_FILE: 'ERR_NO_FILE',
  ERR_UNSUPPORTED_FORMAT: 'ERR_UNSUPPORTED_FORMAT',
  ERR_CORRUPT_IMAGE: 'ERR_CORRUPT_IMAGE',
  ERR_CORRUPT_PDF: 'ERR_CORRUPT_PDF',
  ERR_QUEUE_FULL: 'ERR_QUEUE_FULL',
  ERR_JOB_NOT_FOUND: 'ERR_JOB_NOT_FOUND',
  ERR_JOB_EXPIRED: 'ERR_JOB_EXPIRED',
  ERR_PROCESSING_FAILED: 'ERR_PROCESSING_FAILED',
  ERR_TIMEOUT: 'ERR_TIMEOUT',
  ERR_INTERNAL: 'ERR_INTERNAL',
};
