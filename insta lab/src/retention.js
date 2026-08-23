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
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { deleted, freedBytes, skipped: false };
}
