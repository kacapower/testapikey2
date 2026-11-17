import fs from 'node:fs/promises';

/**
 * Lightweight, zero-dependency Supabase Storage client
 * Uses standard native fetch for minimal memory footprint in 512 MB RAM environments.
 */
export class SupabaseStorage {
  constructor(config = {}) {
    this.url = config.url ? config.url.replace(/\/+$/, '') : null;
    this.serviceKey = config.serviceKey || null;
    this.bucket = config.bucket || 'file-utility-temp';
    this.enabled = !!(this.url && this.serviceKey);
    this._bucketVerified = false;
  }

  isConfigured() {
    return this.enabled;
  }

  getHeaders(extra = {}) {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      ...extra,
    };
  }

  async ensureBucket() {
    if (!this.enabled || this._bucketVerified) return true;
    try {
      // 1. Check if bucket exists
      const checkRes = await fetch(`${this.url}/storage/v1/bucket/${this.bucket}`, {
        headers: this.getHeaders(),
      });

      if (checkRes.ok) {
        this._bucketVerified = true;
        return true;
      }

      // 2. Create bucket with public access for fast CDN downloads & 30 MB limit
      const createRes = await fetch(`${this.url}/storage/v1/bucket`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: this.bucket,
          name: this.bucket,
          public: true,
          file_size_limit: 30 * 1024 * 1024,
        }),
      });

      if (createRes.ok || createRes.status === 409) {
        this._bucketVerified = true;
        return true;
      }

      console.warn(`[supabase-storage] createBucket returned status ${createRes.status}`);
      return false;
    } catch (err) {
      console.warn(`[supabase-storage] ensureBucket error: ${err.message}`);
      return false;
    }
  }

  async uploadFile(objectPath, bufferOrPath, mimeType) {
    if (!this.enabled) return null;
    await this.ensureBucket();

    let buffer;
    if (Buffer.isBuffer(bufferOrPath)) {
      buffer = bufferOrPath;
    } else {
      buffer = await fs.readFile(bufferOrPath);
    }

    const cleanPath = objectPath.replace(/^\/+/, '');
    const uploadUrl = `${this.url}/storage/v1/object/${this.bucket}/${cleanPath}`;

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: this.getHeaders({
        'Content-Type': mimeType || 'application/octet-stream',
        'x-upsert': 'true',
      }),
      body: buffer,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Supabase upload failed (HTTP ${res.status}): ${errText}`);
    }

    // Generate signed download URL (strictly 300 seconds = 5 minutes expiry)
    const signedUrl = await this.createSignedUrl(cleanPath, 300);

    return {
      bucket: this.bucket,
      objectPath: cleanPath,
      signedUrl: signedUrl || `${this.url}/storage/v1/object/public/${this.bucket}/${cleanPath}`,
      publicUrl: `${this.url}/storage/v1/object/public/${this.bucket}/${cleanPath}`,
      expiresIn: 300,
    };
  }

  async createSignedUrl(objectPath, expiresIn = 300) {
    if (!this.enabled) return null;
    try {
      const cleanPath = objectPath.replace(/^\/+/, '');
      const signUrl = `${this.url}/storage/v1/object/sign/${this.bucket}/${cleanPath}`;
      const res = await fetch(signUrl, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data.signedURL) return null;
      return `${this.url}/storage/v1${data.signedURL}`;
    } catch (_) {
      return null;
    }
  }

  async deleteObject(objectPath) {
    if (!this.enabled || !objectPath) return false;
    try {
      const cleanPath = objectPath.replace(/^\/+/, '');
      const deleteUrl = `${this.url}/storage/v1/object/${this.bucket}`;
      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [cleanPath] }),
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }
}
