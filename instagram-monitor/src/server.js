import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { hashPassword, verifyPassword, issueToken, verifyToken, sessionCookie, clearSessionCookie, parseCookies } from './auth.js';
import { schedule, isDue, profileInterval } from './poller.js';
import { pollAndNotify } from './notify.js';
import { cleanupOldMedia } from './retention.js';
import { buildBackupArchive } from './backup.js';
import { syncToHF, deleteFromHF, restoreFromHF, hfEnabled, createSyncDebouncer } from './hf.js';
import { sendTelegram, telegramConfigured } from './telegram.js';

export function createApp({ config = loadConfig(), store = new Store(config.dataDir) } = {}) {
  const app = express();
  app.use(express.json());

  const syncDebouncer = createSyncDebouncer(config, store);
  store.onChange(() => syncDebouncer.schedule());

  app.use(express.static(config.publicDir, { extensions: ['html'] }));

  function isAuthed(req) {
    const cookies = parseCookies(req);
    return verifyToken(cookies.igmon, config.secret);
  }

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    return res.status(401).json({ error: 'Authentication required.' });
  }

  function isPollAllowed(req) {
    if (isAuthed(req)) return true;
    const header = req.get('x-poll-token');
    return !!header && header === config.pollToken;
  }

  function requirePollAccess(req, res, next) {
    if (isPollAllowed(req)) return next();
    return res.status(401).json({ error: 'Not authorized to trigger a poll.' });
  }

  app.get('/api/status', (req, res) => {
    const cfg = store.getConfig();
    const passwordSet = !!store.getPasswordHash();
    const authed = isAuthed(req);
    const now = Date.now();
    const profiles = (cfg.profiles || []).map((p) => {
      const intervalHours = profileInterval(p, config);
      const nextPollAt = p.lastPolledAt
        ? new Date(Date.parse(p.lastPolledAt) + intervalHours * 60 * 60 * 1000).toISOString()
        : null;
      return { ...p, intervalHours, nextPollAt, due: isDue(p, config, now), lastStoriesError: p.lastStoriesError || null };
    });
    res.json({
      passwordSet,
      locked: passwordSet && !authed,
      profiles: authed ? profiles : [],
      intervalHours: cfg.intervalHours || config.pollIntervalHours,
      batchIntervalHours: config.batchIntervalHours,
      privacyPing: true,
      storiesEnabled: !!config.storiesActor,
      lastPollAt: cfg.lastPollAt,
      lastPollStatus: cfg.lastPollStatus,
      lastPollError: cfg.lastPollError,
      nextPollAt: cfg.nextPollAt,
      totalSnapshots: cfg.totalSnapshots || 0,
      totalChanges: cfg.totalChanges || 0,
      retentionEnabled: cfg.retentionEnabled !== false,
      retentionDays: cfg.retentionDays || config.retentionDays,
      alertsEnabled: cfg.alertsEnabled !== false,
      summaryEnabled: cfg.summaryEnabled !== false,
      summaryHour: cfg.summaryHour || config.summaryHour,
      telegramEnabled: telegramConfigured(config),
      hfEnabled: hfEnabled(config),
      hfDataset: config.hfDataset || null,
      hfLastUploadAt: cfg.hfLastUploadAt || null,
      hfLastError: cfg.hfLastError || null,
    });
  });

  app.post('/api/setup', async (req, res) => {
    if (store.getPasswordHash()) {
      return res.status(400).json({ error: 'Password already set. Log in instead.' });
    }
    const { password } = req.body || {};
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }
    const hash = await hashPassword(String(password));
    store.setPasswordHash(hash);
    res.setHeader('Set-Cookie', sessionCookie(issueToken(config.secret), config.secret));
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    const { password } = req.body || {};
    const hash = store.getPasswordHash();
    if (!hash) {
      return res.status(400).json({ error: 'No password configured yet. Complete setup first.' });
    }
    const ok = await verifyPassword(String(password || ''), hash);
    if (!ok) {
      return res.status(401).json({ error: 'Wrong password.' });
    }
    res.setHeader('Set-Cookie', sessionCookie(issueToken(config.secret), config.secret));
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  function normalizeUsername(input) {
    const username = String(input || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
      .replace(/\/+$/, '')
      .replace(/^@/, '');
    return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : null;
  }

  app.post('/api/config', requireAuth, (req, res) => {
    const body = req.body || {};
    const patch = {};
    if (typeof body.intervalHours === 'number') {
      const h = body.intervalHours;
      if (!(h >= 1 && h <= 168)) {
        return res.status(400).json({ error: 'intervalHours must be between 1 and 168.' });
      }
      patch.intervalHours = h;
    }
    if (typeof body.retentionEnabled === 'boolean') patch.retentionEnabled = body.retentionEnabled;
    if (typeof body.retentionDays === 'number') {
      const d = body.retentionDays;
      if (!(d >= 1 && d <= 365)) {
        return res.status(400).json({ error: 'retentionDays must be between 1 and 365.' });
      }
      patch.retentionDays = d;
    }
    if (typeof body.alertsEnabled === 'boolean') patch.alertsEnabled = body.alertsEnabled;
    if (typeof body.summaryEnabled === 'boolean') patch.summaryEnabled = body.summaryEnabled;
    if (typeof body.summaryHour === 'number') {
      const h = body.summaryHour;
      if (!(h >= 0 && h <= 23)) {
        return res.status(400).json({ error: 'summaryHour must be between 0 and 23.' });
      }
      patch.summaryHour = h;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }
    store.setConfig(patch);
    const cfg = store.getConfig();
    res.json({ ok: true, ...patch, intervalHours: patch.intervalHours ?? cfg.intervalHours });
  });

  app.post('/api/config/profiles', requireAuth, (req, res) => {
    const body = req.body || {};
    const username = normalizeUsername(body.username);
    if (!username) {
      return res.status(400).json({ error: 'Invalid Instagram username.' });
    }
    const added = store.addProfile(username, {
      backfill: typeof body.backfill === 'boolean' ? body.backfill : undefined,
      trackStories: typeof body.trackStories === 'boolean' ? body.trackStories : undefined,
    });
    if (!added) {
      return res.status(400).json({ error: `"${username}" is already tracked.` });
    }
    res.json({ ok: true, username, profiles: store.getProfiles() });
  });

  app.patch('/api/config/profiles/:username', requireAuth, (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ error: 'Invalid Instagram username.' });
    }
    const body = req.body || {};
    const patch = {};
    if (typeof body.backfill === 'boolean') patch.backfill = body.backfill;
    if (typeof body.trackStories === 'boolean') patch.trackStories = body.trackStories;
    if (typeof body.intervalHours === 'number') {
      const h = body.intervalHours;
      if (!(h >= 1 && h <= 168)) {
        return res.status(400).json({ error: 'intervalHours must be between 1 and 168.' });
      }
      patch.intervalHours = h;
    } else if (body.intervalHours === null) {
      patch.intervalHours = null;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }
    const updated = store.updateProfile(username, patch);
    if (!updated) {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    res.json({ ok: true, profile: updated });
  });

  app.post('/api/config/profiles/:username/rename', requireAuth, async (req, res) => {
    const oldUsername = normalizeUsername(req.params.username);
    const newUsername = normalizeUsername((req.body || {}).to);
    if (!oldUsername || !newUsername) {
      return res.status(400).json({ error: 'Invalid Instagram username.' });
    }
    const updated = store.renameProfile(oldUsername, newUsername);
    if (updated === null) return res.status(404).json({ error: 'Profile not found.' });
    if (updated === false) return res.status(400).json({ error: `"${newUsername}" is already tracked.` });
    if (hfEnabled(config)) {
      try {
        await deleteFromHF(config, store, oldUsername);
        await syncToHF(store, config);
      } catch (err) {
        console.warn(`[hf] rename sync failed: ${err.message}`);
      }
    }
    res.json({ ok: true, username: newUsername, profile: updated });
  });

  app.delete('/api/config/profiles/:username', requireAuth, async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ error: 'Invalid Instagram username.' });
    }
    store.removeProfile(username);
    if (hfEnabled(config)) {
      try {
        await deleteFromHF(config, store, username);
      } catch (err) {
        console.warn(`[hf] delete sync failed: ${err.message}`);
      }
    }
    res.json({ ok: true, username, profiles: store.getProfiles() });
  });

  app.post('/api/poll', requirePollAccess, async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const result = await pollAndNotify(store, config, { force });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/data/usage', requireAuth, (req, res) => {
    const cfg = store.getConfig();
    const profiles = (cfg.profiles || []).map((p) => {
      const dir = path.join(store.mediaDir, p.username);
      let bytes = 0;
      let files = 0;
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          try {
            const st = fs.statSync(full);
            if (st.isFile()) {
              bytes += st.size;
              files += 1;
            }
          } catch {
            /* ignore */
          }
        }
      }
      return { username: p.username, files, bytes };
    });
    const totalBytes = profiles.reduce((sum, p) => sum + p.bytes, 0);
    const totalFiles = profiles.reduce((sum, p) => sum + p.files, 0);
    res.json({ profiles, totalBytes, totalFiles });
  });

  app.post('/api/data/cleanup', requireAuth, (req, res) => {
    const result = cleanupOldMedia(store, config);
    res.json({ ok: true, ...result });
  });

  app.get('/api/backup', requireAuth, (req, res) => {
    const archive = buildBackupArchive(store);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="instagram-monitor-${new Date().toISOString().slice(0, 10)}.zip"`);
    archive.pipe(res);
    archive.on('error', () => res.destroy());
  });

  app.get('/api/backup/:username', requireAuth, (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) return res.status(400).json({ error: 'Invalid Instagram username.' });
    const archive = buildBackupArchive(store, { username });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${username}-backup.zip"`);
    archive.pipe(res);
    archive.on('error', () => res.destroy());
  });

  app.post('/api/hf/sync', requireAuth, async (req, res) => {
    if (!hfEnabled(config)) {
      return res.status(400).json({ error: 'HF not configured. Set HF_TOKEN and HF_DATASET.' });
    }
    try {
      const r = await syncToHF(store, config);
      store.mute(() => {
        const cfg = store.getConfig();
        store.setConfig({
          hfLastUploadAt: r.ok ? new Date().toISOString() : cfg.hfLastUploadAt || null,
          hfLastError: r.ok ? null : (r.errors || []).join('; ') || null,
        });
      });
      res.json({ ok: true, uploaded: r.uploaded, errors: r.errors });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/alerts/test', requireAuth, async (req, res) => {
    if (!telegramConfigured(config)) {
      return res.status(400).json({ error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_USER_IDS.' });
    }
    const r = await sendTelegram(config, '[Instagram Monitor] Test message — Telegram alerts are working.');
    res.json({ ok: r.ok, results: r.results });
  });

  app.get('/api/media/all', requireAuth, (req, res) => {
    const items = [];
    if (fs.existsSync(store.mediaDir)) {
      for (const username of fs.readdirSync(store.mediaDir)) {
        const dir = path.join(store.mediaDir, username);
        let stat;
        try {
          stat = fs.statSync(dir);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!/^[a-zA-Z0-9._-]+\.(jpe?g|png|webp|gif|mp4|webm)$/i.test(file)) continue;
          const full = path.join(dir, file);
          try {
            const st = fs.statSync(full);
            if (!st.isFile()) continue;
            items.push({ username, file, kind: file.startsWith('avatar-') ? 'avatar' : file.startsWith('story-') ? 'story' : 'post', size: st.size, mtime: st.mtimeMs, url: `/api/media/${encodeURIComponent(username)}/${encodeURIComponent(file)}` });
          } catch {
            /* ignore */
          }
        }
      }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    res.json({ items });
  });

  app.get('/api/history', requireAuth, (req, res) => {
    const h = store.getHistory();
    res.json(h);
  });

  app.get('/api/history/:username', requireAuth, (req, res) => {
    const h = store.getHistory();
    const list = h.profiles[req.params.username] || [];
    res.json({ username: req.params.username, snapshots: list });
  });

  app.get('/api/media/:username/:file', requireAuth, (req, res) => {
    const { username, file } = req.params;
    if (!/^[a-zA-Z0-9._-]+$/.test(username) || !/^[a-zA-Z0-9._-]+\.(jpe?g|png|webp|gif|mp4|webm)$/i.test(file)) {
      return res.status(400).json({ error: 'Invalid path.' });
    }
    const full = path.join(store.mediaDir, username, file);
    if (!full.startsWith(path.join(store.mediaDir, username) + path.sep)) {
      return res.status(400).json({ error: 'Invalid path.' });
    }
    res.sendFile(full, (err) => {
      if (err) res.status(404).json({ error: 'File not found.' });
    });
  });

  return app;
}

export async function main() {
  const config = loadConfig();
  const store = new Store(config.dataDir);

  try {
    const restored = await Promise.race([
      restoreFromHF(config, store),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, skipped: true, reason: 'timeout' }), 120000)),
    ]);
    if (!restored.skipped) {
      console.log(`[restore] ${restored.restored} file(s) restored from HF${restored.errors?.length ? ` (${restored.errors.length} failed)` : ''}`);
    }
  } catch (err) {
    console.warn(`[restore] failed: ${err.message}`);
  }

  const app = createApp({ config, store });

  schedule(config, store, { keepAlive: true, onPoll: (s, c) => pollAndNotify(s, c) });

  cleanupOldMedia(store, config);
  setInterval(() => {
    const r = cleanupOldMedia(store, config);
    if (!r.skipped && r.deleted > 0) {
      console.log(`[retention] removed ${r.deleted} file(s), freed ${(r.freedBytes / 1024 / 1024).toFixed(2)} MB`);
    }
  }, 30 * 60 * 1000);

  app.listen(config.port, () => {
    console.log(`Instagram Monitor listening on http://localhost:${config.port}`);
    console.log(`Poll interval: every ${config.pollIntervalHours} hour(s)`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
