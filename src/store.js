import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, PASSWORD_FILE, HISTORY_FILE, HF_MANIFEST_FILE } from './config.js';

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.mediaDir = path.join(dataDir, 'media');
    this._changeListeners = new Set();
    this._silent = 0;
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  /** Subscribes to state mutations. Returns an unsubscribe function. */
  onChange(cb) {
    this._changeListeners.add(cb);
    return () => this._changeListeners.delete(cb);
  }

  /** Runs a callback suppressing change notifications (used by sync internals). */
  mute(cb) {
    this._silent += 1;
    try {
      return cb();
    } finally {
      this._silent -= 1;
    }
  }

  _emitChange() {
    if (this._silent) return;
    for (const cb of this._changeListeners) {
      try {
        cb();
      } catch {
        /* listener errors are non-fatal */
      }
    }
  }

  _file(name) {
    return path.join(this.dataDir, name);
  }

  readJson(name, fallback) {
    try {
      const raw = fs.readFileSync(this._file(name), 'utf8');
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  writeJson(name, value) {
    const tmp = this._file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this._file(name));
  }

  getConfig() {
    const cfg = this.readJson(CONFIG_FILE, null);
    const defaults = {
      profiles: [],
      intervalHours: null,
      lastPollAt: null,
      lastPollStatus: 'idle',
      lastPollError: null,
      nextPollAt: null,
      totalSnapshots: 0,
      totalChanges: 0,
      retentionEnabled: true,
      retentionDays: 7,
      alertsEnabled: null,
      summaryEnabled: null,
      summaryHour: null,
      lastSummaryDate: null,
      hfLastUploadAt: null,
      hfLastError: null,
    };
    if (!cfg) return defaults;
    if (Array.isArray(cfg.profiles)) return { ...defaults, ...cfg };
    const migrated = { ...defaults, ...cfg };
    if (cfg.username) {
      migrated.profiles = [this._normalizeProfileEntry({ username: cfg.username, addedAt: cfg.addedAt || null })];
    }
    delete migrated.username;
    delete migrated.addedAt;
    this.writeJson(CONFIG_FILE, migrated);
    return migrated;
  }

  _normalizeProfileEntry(entry) {
    return {
      username: entry.username,
      addedAt: entry.addedAt || new Date().toISOString(),
      backfill: entry.backfill !== undefined ? !!entry.backfill : true,
      trackStories: entry.trackStories !== undefined ? !!entry.trackStories : true,
      isPrivate: entry.isPrivate ?? null,
      batchIntervalHours: entry.batchIntervalHours ?? null,
      intervalHours: entry.intervalHours ?? null,
      lastPolledAt: entry.lastPolledAt || null,
      seenStories: Array.isArray(entry.seenStories) ? entry.seenStories : [],
    };
  }

  addProfile(username, opts = {}) {
    const cfg = this.getConfig();
    const profiles = cfg.profiles || [];
    if (profiles.some((p) => p.username === username)) return false;
    const entry = this._normalizeProfileEntry({
      username,
      addedAt: new Date().toISOString(),
      backfill: opts.backfill,
      trackStories: opts.trackStories,
      intervalHours: opts.intervalHours,
    });
    profiles.push(entry);
    this.setConfig({ profiles });
    return true;
  }

  updateProfile(username, patch) {
    const cfg = this.getConfig();
    const profiles = (cfg.profiles || []).map((p) => (p.username === username ? this._normalizeProfileEntry({ ...p, ...patch }) : p));
    this.setConfig({ profiles });
    return profiles.find((p) => p.username === username) || null;
  }

  removeProfile(username) {
    const cfg = this.getConfig();
    const profiles = (cfg.profiles || []).filter((p) => p.username !== username);
    this.setConfig({ profiles });
  }

  renameProfile(oldUsername, newUsername) {
    const cfg = this.getConfig();
    const target = (cfg.profiles || []).find((p) => p.username === oldUsername);
    if (!target) return null;
    if ((cfg.profiles || []).some((p) => p.username === newUsername)) return false;
    const profiles = (cfg.profiles || []).map((p) => (p.username === oldUsername ? { ...p, username: newUsername } : p));
    this.setConfig({ profiles });

    const oldMedia = path.join(this.mediaDir, oldUsername);
    const newMedia = path.join(this.mediaDir, newUsername);
    if (fs.existsSync(oldMedia) && !fs.existsSync(newMedia)) {
      try {
        fs.renameSync(oldMedia, newMedia);
      } catch {
        /* non-fatal */
      }
    }

    const h = this.getHistory();
    if (h.profiles[oldUsername]) {
      h.profiles[newUsername] = h.profiles[oldUsername];
      delete h.profiles[oldUsername];
      this.setHistory(h);
    }

    return profiles.find((p) => p.username === newUsername) || null;
  }

  getHfManifest() {
    return this.readJson(HF_MANIFEST_FILE, {});
  }

  setHfManifest(manifest) {
    this.writeJson(HF_MANIFEST_FILE, manifest);
    this._emitChange();
  }

  getProfiles() {
    return this.getConfig().profiles || [];
  }

  setConfig(patch) {
    const cfg = { ...this.getConfig(), ...patch };
    this.writeJson(CONFIG_FILE, cfg);
    this._emitChange();
    return cfg;
  }

  getPasswordHash() {
    const v = this.readJson(PASSWORD_FILE, null);
    return v ? v.hash : null;
  }

  setPasswordHash(hash) {
    this.writeJson(PASSWORD_FILE, { hash, setAt: new Date().toISOString() });
    this._emitChange();
  }

  getHistory() {
    return this.readJson(HISTORY_FILE, { profiles: {} });
  }

  setHistory(h) {
    this.writeJson(HISTORY_FILE, h);
    this._emitChange();
  }

  saveSnapshot(username, snapshot) {
    const h = this.getHistory();
    const list = h.profiles[username] || [];
    list.push(snapshot);
    h.profiles[username] = list;
    this.setHistory(h);
  }

  mediaPathFor(username, fileName) {
    const dir = path.join(this.mediaDir, username);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, fileName);
  }
}
