# ==============================================================================
# Multi-Stage Dockerfile for Render Free Tier File Utility API
# Target Image Size: < 200 MB
# Memory Constraint: 512 MB RAM (configured heap limit 384 MB)
# ==============================================================================

# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools if any native modules need compilation
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && \
    npm cache clean --force

# Stage 2: Minimal Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Install minimal runtime dependency for PDF conversion (pdftoppm) and wget for healthcheck
RUN apk add --no-cache poppler-utils wget ca-certificates && \
    rm -rf /var/cache/apk/* /tmp/*

ENV NODE_ENV=production
ENV PORT=3000
ENV TEMP_DIR=/tmp/file-utility
ENV MAX_CONCURRENT_JOBS=1
ENV MAX_FILE_SIZE_MB=25

# Create scratch directory for temporary conversion payloads and assign node user
RUN mkdir -p /tmp/file-utility && \
    chown -R node:node /tmp/file-utility /app

# Copy production dependencies from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Run as non-privileged user
USER node

EXPOSE 3000

# Cold-start and container health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Launch with capped V8 heap (384MB) to leave headroom for OS & poppler inside 512MB RAM
CMD ["node", "--max-old-space-size=384", "src/server.js"]
