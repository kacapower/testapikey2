import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HF_API = 'https://huggingface.co';
const LFS_HEADERS = {
  Accept: 'application/vnd.git-lfs+json',
  'Content-Type': 'application/vnd.git-lfs+json',
};
const SAMPLE_SIZE = 512;

export function hfEnabled(config) {
  return !!config.hfToken && !!config.hfDataset;
}

function authHeaders(config) {
  return { Authorization: `Bearer ${config.hfToken}` };
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* keep null */
    }
    throw new Error(`${res.status}: ${body?.error || res.statusText}`);
  }
  return res.json();
}

export async function ensureRepo(config) {
  const info = await fetch(`${HF_API}/api/datasets/${config.hfDataset}`, {
    headers: authHeaders(config),
  });
  if (info.status === 200) return { created: false };
  if (info.status !== 404) throw new Error(`HF repo check failed (${info.status})`);
  const res = await fetch(`${HF_API}/api/repos`, {
    method: 'POST',
    headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: config.hfDataset, type: 'dataset', private: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`HF repo create failed (${res.status}): ${body?.error || ''}`);
  }
  return { created: true };
}

function fileInfo(buf) {
  return {
    size: buf.length,
    sample: buf.subarray(0, SAMPLE_SIZE).toString('base64'),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

/** Asks the hub whether each path must be uploaded as LFS or regular content. */
async function preupload(config, files) {
  return fetchJson(`${HF_API}/api/datasets/${config.hfDataset}/preupload/main`, {
    method: 'POST',
    headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: files.map((f) => ({ path: f.path, sample: f.sample, size: f.size })),
    }),
  });
}

/** Uploads an LFS-tracked blob (git-lfs basic transfer). No-op if content already exists. */
async function lfsUpload(config, sha256Hex, buf) {
  const batch = await fetchJson(`${HF_API}/datasets/${config.hfDataset}.git/info/lfs/objects/batch`, {
    method: 'POST',
    headers: { ...authHeaders(config), ...LFS_HEADERS },
    body: JSON.stringify({
      operation: 'upload',
      transfers: ['basic'],
      hash_algo: 'sha256',
      ref: { name: 'main' },
      objects: [{ oid: sha256Hex, size: buf.length }],
    }),
  });
  const obj = batch.objects?.[0];
  if (!obj) throw new Error('LFS batch returned no object');
  if (obj.error) throw new Error(`LFS: ${obj.error.message || JSON.stringify(obj.error)}`);
  const action = obj.actions?.upload;
  if (!action) return; // blob already present upstream
  const put = await fetch(action.href, { method: 'PUT', body: buf });
  if (!put.ok) throw new Error(`LFS PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
  if (obj.actions?.verify) {
    const ver = await fetch(obj.actions.verify.href, {
      method: 'POST',
      headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ oid: sha256Hex, size: buf.length }),
    });
    if (!ver.ok) throw new Error(`LFS verify ${ver.status}`);
  }
}

/** POSTs newline-delimited JSON operations to the commit endpoint. */
async function commitNDJSON(config, entries, title) {
  const lines = [
    JSON.stringify({
      key: 'header',
      value: { summary: title || 'instagram-monitor sync', description: 'Automatic sync from Instagram Monitor' },
    }),
  ];
  for (const e of entries) lines.push(JSON.stringify(e));
  const res = await fetch(`${HF_API}/api/datasets/${config.hfDataset}/commit/main`, {
    method: 'POST',
    headers: { ...authHeaders(config), 'Content-Type': 'application/x-ndjson' },
    body: lines.join('\n') + '\n',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`commit ${res.status}: ${body?.error || ''}`);
  }
  return res.json();
}

const BATCH_MAX_BYTES = 4 * 1024 * 1024;
const BATCH_MAX_OPS = 20;

function chunkOperations(ops) {
  const batches = [];
  let cur = [];
  let size = 0;
  for (const o of ops) {
    if (cur.length && (size + o.buf.length > BATCH_MAX_BYTES || cur.length >= BATCH_MAX_OPS)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(o);
    size += o.buf.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function commitBatch(config, batch, title) {
  const info = batch.map((o) => ({ path: o.path, ...fileInfo(o.buf) }));
  const meta = await preupload(config, info);
  const entries = [];
  for (const item of meta.files) {
    const op = batch.find((o) => o.path === item.path);
    if (item.shouldIgnore) continue; // identical content already at this path
    if (item.uploadMode === 'lfs') {
      const fi = fileInfo(op.buf);
      await lfsUpload(config, fi.sha256, op.buf);
      entries.push({ key: 'lfsFile', value: { path: op.path, algo: 'sha256', oid: fi.sha256, size: fi.size } });
    } else {
      entries.push({ key: 'file', value: { path: op.path, encoding: 'base64', content: op.buf.toString('base64') } });
    }
  }
  if (entries.length) await commitNDJSON(config, entries, title);
}

/**
 * Uploads each profile's data as a per-person folder on the dataset:
 *   <user>/profile.json   <user>/history.json   <user>/media/<files>
 * Media files already recorded in the manifest are skipped, so re-running is
 * cheap and acts as a retry for anything that failed earlier.
 */
export async function syncToHF(store, config) {
  if (!hfEnabled(config)) return { ok: false, skipped: true, reason: 'HF not configured (HF_TOKEN + HF_DATASET)' };
  await ensureRepo(config);

  const manifest = store.getHfManifest();
  const cfg = store.getConfig();
  const h = store.getHistory();
  const ops = [];
  let toUpload = 0;

  const metaFiles = {
    '_meta/config.json': { ...cfg },
    '_meta/hf-manifest.json': manifest,
  };
  for (const [rel, data] of Object.entries(metaFiles)) {
    ops.push({ path: rel, user: '_meta', rel, buf: Buffer.from(JSON.stringify(data, null, 2)) });
    toUpload += 1;
  }

  for (const p of cfg.profiles || []) {
    const user = p.username;
    const jsonFiles = {
      'profile.json': { ...p },
      'history.json': h.profiles[user] || [],
    };
    for (const [rel, data] of Object.entries(jsonFiles)) {
      ops.push({ path: `${user}/${rel}`, user, rel, buf: Buffer.from(JSON.stringify(data, null, 2)) });
      toUpload += 1;
    }

    const dir = path.join(store.mediaDir, user);
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const rel = `media/${name}`;
        if (manifest[user] && manifest[user][rel]) continue;
        const full = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        ops.push({ path: `${user}/${rel}`, user, rel, buf: fs.readFileSync(full) });
        toUpload += 1;
      }
    }
  }

  const errors = [];
  let uploaded = 0;
  for (const batch of chunkOperations(ops)) {
    try {
      await commitBatch(config, batch, `instagram-monitor sync (${uploaded + 1}-${uploaded + batch.length})`);
      for (const o of batch) {
        (manifest[o.user] = manifest[o.user] || {})[o.rel] = new Date().toISOString();
      }
      uploaded += batch.length;
    } catch (err) {
      errors.push(err.message);
    }
  }

  store.setHfManifest(manifest);
  return { ok: errors.length === 0, uploaded, toUpload, errors };
}

/** Removes all files of a person's folder from the dataset (used on rename). */
export async function deleteFromHF(config, store, username) {
  if (!hfEnabled(config)) return { ok: false, skipped: true };
  const manifest = store.getHfManifest();
  const paths = Object.keys(manifest[username] || {}).map((rel) => `${username}/${rel}`);
  if (!paths.length) return { ok: true, deleted: 0 };
  const entries = paths.map((p) => ({ key: 'deletedFile', value: { path: p } }));
  const half = Math.ceil(entries.length / 2);
  for (let i = 0; i < entries.length; i += half) {
    await commitNDJSON(config, entries.slice(i, i + half), `remove folder for ${username}`);
  }
  delete manifest[username];
  store.setHfManifest(manifest);
  return { ok: true, deleted: paths.length };
}

function safeSegments(rel) {
  const segs = rel.split('/').filter(Boolean);
  if (!segs.length) return null;
  if (segs.some((s) => s === '..' || s === '.' || s.includes('\\'))) return null;
  return segs;
}

async function downloadResolve(config, rel) {
  const res = await fetch(`${HF_API}/datasets/${config.hfDataset}/resolve/main/${rel}`, {
    headers: authHeaders(config),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`resolve ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty file');
  return buf;
}

/**
 * Pulls all backed-up state back into the local data dir. Intended for a
 * freshly-deployed (ephemeral-disk) instance so the gallery, profiles and
 * history survive redeploys. Layout mapping:
 *   _meta/config.json      -> config.json        (only when local has no profiles)
 *   _meta/hf-manifest.json -> hf-manifest.json   (only when missing)
 *   <user>/profile.json    -> profile entry merged into config profiles
 *   <user>/history.json    -> merged into history.profiles[user]
 *   <user>/media/<file>    -> media/<user>/<file>
 * Existing local files are never overwritten.
 */
export async function restoreFromHF(config, store) {
  if (!hfEnabled(config)) return { ok: false, skipped: true, reason: 'HF not configured (HF_TOKEN + HF_DATASET)' };
  const res = await fetch(`${HF_API}/api/datasets/${config.hfDataset}/tree/main?recursive=1`, {
    headers: authHeaders(config),
  });
  if (res.status === 404) return { ok: true, skipped: true, reason: 'dataset empty' };
  if (!res.ok) throw new Error(`HF tree ${res.status}`);
  const items = await res.json();
  const files = (items || []).filter((i) => i.type === 'file' && !i.path.startsWith('.'));

  const errors = [];
  let restored = 0;
  let changedProfiles = false;

  const cfg = store.getConfig();
  const history = store.getHistory();

  for (const f of files) {
    try {
      const segs = safeSegments(f.path);
      if (!segs) continue;

      if (segs[0] === '_meta') {
        if (segs[1] === 'config.json') {
          if (!(cfg.profiles || []).length) {
            const buf = await downloadResolve(config, f.path);
            store.writeJson('config.json', JSON.parse(buf.toString('utf8')));
            restored += 1;
          }
        } else if (segs[1] === 'hf-manifest.json') {
          if (!fs.existsSync(store._file('hf-manifest.json'))) {
            const buf = await downloadResolve(config, f.path);
            store.writeJson('hf-manifest.json', JSON.parse(buf.toString('utf8')));
            restored += 1;
          }
        }
        continue;
      }

      if (segs.length >= 3 && segs[1] === 'media') {
        const [user, , ...rest] = segs;
        const dest = path.join(store.mediaDir, user, ...rest);
        if (fs.existsSync(dest)) continue;
        const buf = await downloadResolve(config, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        restored += 1;
        continue;
      }

      if (segs[1] === 'history.json') {
        const user = segs[0];
        if (!history.profiles[user] || !history.profiles[user].length) {
          const buf = await downloadResolve(config, f.path);
          const merged = JSON.parse(buf.toString('utf8'));
          history.profiles[user] = merged;
          restored += 1;
        }
        continue;
      }

      if (segs[1] === 'profile.json') {
        const user = segs[0];
        if (!(cfg.profiles || []).some((p) => p.username === user)) {
          const buf = await downloadResolve(config, f.path);
          const entry = { username: user, ...JSON.parse(buf.toString('utf8')) };
          cfg.profiles.push(entry);
          changedProfiles = true;
          restored += 1;
        }
      }
    } catch (err) {
      errors.push(`${f.path}: ${err.message}`);
    }
  }

  if (changedProfiles) store.setConfig({ profiles: cfg.profiles });
  if (restored) {
    store.writeJson('history.json', history);
    store.writeJson('hf-manifest.json', store.getHfManifest());
  }

  return { ok: errors.length === 0, restored, errors };
}