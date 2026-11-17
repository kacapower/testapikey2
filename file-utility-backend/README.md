# Client-Fronted Server-Queued File Utility System (Backend)

Containerized, memory-defensive Node.js backend API engineered for **Render.com Free Tier** (512 MB RAM limit, 0.1 vCPU).

---

## 1. Architectural Highlights

- **Strict FIFO In-Memory "Row" Queue**: Guarantees a hard concurrency limit (default: 1 active job) so parallel conversions never trigger cgroup Out-Of-Memory (OOM) kills on Render.
- **Render Cold-Start Health Engine**: `GET /api/health` returns immediate 200 OK along with live telemetry (`queueLength`, `activeJobs`, RSS & heap metrics) for the frontend waking indicator.
- **Zero-Storage InfinityFree Compliant**: InfinityFree hosts only pure static UI assets; all files and conversions route directly to/from this Render API with CORS support.
- **Smart Image Compression**: Powered by Sharp with `sharp.cache(false)` and `sharp.concurrency(1)`. Performs iterative binary-search convergence on quality and proportional resolution scaling to hit target file sizes (e.g., <50KB, <100KB, <200KB).
- **Poppler-Backed PDF Conversion**: Subprocess sandboxing using `pdftoppm` with memory and 60-second execution caps. Outputs single-page extractions directly or streams multi-page outputs into a ZIP archive.
- **Ephemeral Auto-Purge**:
  - Processed results are deleted immediately upon completion of client download.
  - An automatic 5-minute timer purges any uncollected jobs.
  - A background sweeper scrubs orphaned temporary files older than 10 minutes.

---

## 2. Environment Configuration

All configuration is managed via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port listened on inside the container |
| `NODE_ENV` | `production` | Runtime mode |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed origins or wildcards for CORS |
| `MAX_CONCURRENT_JOBS` | `1` | Max simultaneous conversions (1 strictly enforced for 512MB RAM) |
| `MAX_QUEUE_SIZE` | `50` | Maximum pending jobs before returning `ERR_QUEUE_FULL` (503) |
| `MAX_FILE_SIZE_MB` | `25` | Maximum upload size enforced at Multer middleware |
| `ESTIMATED_JOB_DURATION_SEC` | `8` | Base seconds per job for frontend ETA estimation |
| `FILE_RETENTION_MS` | `300000` | Expiration window (5 minutes) before uncollected files are purged |
| `JOB_TIMEOUT_MS` | `90000` | Max job execution time before timeout watchdog aborts |
| `TEMP_DIR` | `/tmp/file-utility` | Scratch directory for multipart disk storage |

---

## 3. API Endpoints

### 3.1. Health & Cold-Start Wakeup
```http
GET /api/health
```
**Response (200 OK):**
```json
{
  "status": "ok",
  "service": "render-file-utility",
  "queueLength": 0,
  "activeJobs": 0,
  "concurrencyLimit": 1,
  "memory": {
    "rssMb": 42.1,
    "heapUsedMb": 18.4,
    "heapTotalMb": 24.5
  },
  "uptime": 120,
  "timestamp": "2026-11-17T13:30:00.000Z"
}
```

---

### 3.2. Image Compressor
```http
POST /api/compress-image
Content-Type: multipart/form-data
```
**Form Fields:**
- `file`: Image file (`image/jpeg`, `image/png`, `image/webp`) — Max 25 MB.
- `targetKb` *(optional)*: Numeric target file size (e.g. `100` for 100 KB).
- `quality` *(optional)*: Integer `1`–`100` (default `80`).
- `format` *(optional)*: `'original'`, `'jpeg'`, `'png'`, `'webp'`.
- `maxWidth` *(optional)*: Maximum image width in pixels.
- `maxHeight` *(optional)*: Maximum image height in pixels.

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "queued",
  "position": 1,
  "estimatedWaitSeconds": 8
}
```

---

### 3.3. PDF to Image Converter
```http
POST /api/pdf-to-image
Content-Type: multipart/form-data
```
**Form Fields:**
- `file`: PDF file (`application/pdf`) — Max 25 MB.
- `format` *(optional)*: `'jpg'`, `'png'`, `'webp'` (default `'jpg'`).
- `dpi` *(optional)*: `72`, `150`, or `300` (default `150`).
- `pages` *(optional)*: `'all'`, `'1'`, or range `'1-5'`.

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "queued",
  "position": 2,
  "estimatedWaitSeconds": 16
}
```

---

### 3.4. Job Status Polling
```http
GET /api/jobs/:jobId/status
```

**Responses:**

- **Queued**:
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "queued",
  "progress": 0,
  "position": 2,
  "estimatedWaitSeconds": 16
}
```

- **Processing**:
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "processing",
  "progress": 55,
  "position": 0,
  "estimatedWaitSeconds": 4
}
```

- **Completed**:
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "completed",
  "progress": 100,
  "downloadUrl": "/api/jobs/f47ac10b-58cc-4372-a567-0e02b2c3d479/download",
  "expiresInSeconds": 295,
  "meta": {
    "originalSize": 1420580,
    "resultSize": 98450,
    "compressionRatio": "93%",
    "format": "webp"
  }
}
```

---

### 3.5. One-Time Result Download
```http
GET /api/jobs/:jobId/download
```
- Streams the compressed image or multi-page `.zip` archive.
- The server unlinks the file from disk upon stream completion.

---

## 4. Error Code Reference

All errors follow standard JSON structure:
```json
{
  "success": false,
  "error": {
    "code": "ERR_FILE_TOO_LARGE",
    "message": "File exceeds maximum allowed size of 25 MB."
  }
}
```

| Error Code | HTTP Status | Description |
|---|---|---|
| `ERR_FILE_TOO_LARGE` | `413` | Upload exceeds `MAX_FILE_SIZE_MB` (25MB) |
| `ERR_NO_FILE` | `400` | Form submission missing file payload |
| `ERR_UNSUPPORTED_FORMAT` | `400` | Format not permitted for compressor or converter |
| `ERR_CORRUPT_IMAGE` | `400` | Sharp unable to decode uploaded image |
| `ERR_CORRUPT_PDF` | `400` | Missing `%PDF-` header or unparseable document |
| `ERR_QUEUE_FULL` | `503` | In-memory queue backlog exceeded `MAX_QUEUE_SIZE` |
| `ERR_JOB_NOT_FOUND` | `404` | Unknown or already deleted job |
| `ERR_JOB_EXPIRED` | `410` | 5-minute download retention window elapsed |
| `ERR_TIMEOUT` | `504` | Subprocess or Sharp execution timed out |

---

## 5. Docker & Render.com Deployment

### Building Locally / Testing Container
```bash
docker build -t file-utility-backend .
docker run -p 3000:3000 --memory="512m" --cpus="0.1" file-utility-backend
```

### Deploying to Render Free Tier
1. Connect this repository to Render.
2. Select **Web Service** -> **Docker** environment.
3. Configure Root Directory as `file-utility-backend`.
4. Render detects `Dockerfile` and `render.yaml`.
5. Under **Environment Variables**, set:
   - `ALLOWED_ORIGINS`: `https://your-infinityfree-subdomain.rf.gd` (or `*`)
   - `MAX_CONCURRENT_JOBS`: `1`
   - `MAX_FILE_SIZE_MB`: `25`
