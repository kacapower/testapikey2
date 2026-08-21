import fs from 'node:fs';
import path from 'node:path';

/**
 * Deletes downloaded media older than `retentionDays`, EXCEPT avatar files
 * (avatar-*) which are kept forever. JSON snapshots are always kept.
 * Returns { deleted, freedBytes }.
 */
export function cleanupOldMedia(store, config, { now = Date.now() } = {}) {
  const cfg = store.getConfig();
  if (cfg.retentionEnabled === false) {
    return { deleted: 0, freedBytes: 0, skipped: true };
  }
  const days = Number(cfg.retentionDays) || config.retentionDays;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let freedBytes = 0;
  // Track which (username, filename) pairs got deleted so we can also prune
  // the dangling references to them left behind in history.json — otherwise
  // old snapshots keep pointing at post/story/avatar files that no longer
  // exist on disk, producing broken images in the gallery/API.
  const deletedFiles = new Map(); // username -> Set(filenames)

  const profiles = cfg.profiles || [];
  for (const entry of profiles) {
    const dir = path.join(store.mediaDir, entry.username);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('avatar-')) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < cutoff) {
        try {
          fs.unlinkSync(full);
          deleted += 1;
          freedBytes += stat.size;
          if (!deletedFiles.has(entry.username)) deletedFiles.set(entry.username, new Set());
          deletedFiles.get(entry.username).add(name);
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (deletedFiles.size) {
    const history = store.getHistory();
    let historyChanged = false;
    for (const [username, files] of deletedFiles) {
      const snapshots = history.profiles[username];
      if (!Array.isArray(snapshots)) continue;
      for (const snap of snapshots) {
        if (snap.profile && files.has(snap.profile.profilePicFile)) {
          snap.profile.profilePicFile = null;
          historyChanged = true;
        }
        for (const post of snap.posts || []) {
          if (post.mediaFile && files.has(post.mediaFile)) {
            post.mediaFile = null;
            historyChanged = true;
          }
        }
        for (const story of snap.stories || []) {
          if (story.mediaFile && files.has(story.mediaFile)) {
            story.mediaFile = null;
            historyChanged = true;
          }
        }
      }
    }
    if (historyChanged) store.setHistory(history);
  }

  return { deleted, freedBytes, skipped: false };
}
