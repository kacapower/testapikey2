import fs from 'node:fs';
import crypto from 'node:crypto';
import { runActorSync, normalizeProfile } from './apify.js';
import { diffProfiles, summarize } from './diff.js';
import { fetchStories, filterNewStories, rememberStories } from './stories.js';

const MAX_POST_MEDIA = 20;

function sha8(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

function extensionFor(url) {
  const clean = (url || '').split('?')[0];
  const m = /\.(jpe?g|png|webp|gif|mp4|webm)$/i.exec(clean);
  return m ? m[1].toLowerCase() : 'jpg';
}

function extensionForContentType(ct) {
  if (!ct) return null;
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mp4',
  };
  return map[ct.split(';')[0].trim().toLowerCase()] || null;
}

/**
 * Best-effort upgrade of an Instagram CDN URL to a larger resolution. Only
 * works when the URL is NOT covered by a signature (oh/oe HMAC); signed URLs
 * return 403 and downloadTo falls back to the original.
 */
function upgradeMediaUrl(url) {
  if (!url) return url;
  return url
    .replace(/\b([sp])\d{2,4}x\d{2,4}\b/g, (m, letter) => (letter === 'p' ? 'p1080x1920' : 's1080x1080'))
    .replace(/stp=dst-jpg[^&]*s\d+x\d+/g, 'stp=dst-jpg_e35_s1080x1080');
}

/**
 * Downloads media once. Files are named after the SHA-256 of their bytes, so a
 * repeat image (same hash) is never saved again — "save or reject". Returns the
 * stored file name (or null on failure).
 */
async function downloadTo(store, username, url, kind) {
  if (!url) return null;
  const candidates = [];
  const upgraded = upgradeMediaUrl(url);
  if (upgraded !== url) candidates.push(upgraded);
  candidates.push(url);

  let buf = null;
  let ext = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { redirect: 'follow' });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (!data.length) continue;
      buf = data;
      ext = extensionForContentType(res.headers.get('content-type')) || extensionFor(candidate);
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (!buf) return null;

  const name = `${kind}-${sha8(buf)}.${ext}`;
  const full = store.mediaPathFor(username, name);
  if (!fs.existsSync(full)) {
    fs.writeFileSync(full, buf);
  }
  return name;
}

export function schedule(config, store, options = {}) {
  const minutes = Math.min(config.pollIntervalHours * 60, 60);
  const ms = minutes * 60 * 1000;
  const onPoll = options.onPoll || poll;
  const timer = setInterval(() => {
    onPoll(store, config).catch((err) => {
      console.error('[poller] scheduled poll failed:', err.message);
    });
  }, ms);
  if (timer.unref && !options.keepAlive) timer.unref();
  return timer;
}

export function profileInterval(profile, config) {
  if (Number.isFinite(profile.intervalHours)) return profile.intervalHours;
  return profile.isPrivate ? profile.batchIntervalHours || config.batchIntervalHours : config.pollIntervalHours;
}

export function isDue(profile, config, now = Date.now()) {
  if (!profile.lastPolledAt) return true;
  const hours = profileInterval(profile, config);
  return now - Date.parse(profile.lastPolledAt) >= hours * 60 * 60 * 1000;
}

function filterPostsByBackfill(posts, entry) {
  if (entry.backfill) return posts;
  if (!entry.addedAt) return posts;
  const from = Date.parse(entry.addedAt);
  if (!Number.isFinite(from)) return posts;
  return posts.filter((p) => !p.timestamp || Date.parse(p.timestamp) >= from);
}

async function pollProfile(store, config, entry) {
  const { username } = entry;

  const actorInput = {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: 'details',
    resultsLimit: MAX_POST_MEDIA,
  };
  let raw = await runActorSync(config.apifyActor, actorInput, config.apifyToken);
  let profile = normalizeProfile(raw);

  const isPrivate = profile.isPrivate;

  const history = store.getHistory();
  const prevList = history.profiles[username] || [];
  const prev = prevList.length ? prevList[prevList.length - 1] : null;

  const justWentPublic = !!prev && prev.profile?.isPrivate === true && isPrivate === false;
  if (justWentPublic) {
    const backfillRaw = await runActorSync(config.apifyActor, { ...actorInput, resultsLimit: 30 }, config.apifyToken);
    profile = normalizeProfile(backfillRaw);
  }

  if (isPrivate !== entry.isPrivate) {
    store.updateProfile(username, { isPrivate });
  }

  const profilePicFile = await downloadTo(store, username, profile.profilePicUrl, 'avatar');

  const knownIds = new Set((prev ? prev.posts : []).map((p) => p.id));
  const posts = [];
  if (!isPrivate) {
    const tracked = justWentPublic ? profile.posts : filterPostsByBackfill(profile.posts, entry);
    const cap = justWentPublic ? 30 : MAX_POST_MEDIA;
    for (const post of tracked.slice(0, cap)) {
      const mediaFile = knownIds.has(post.id)
        ? null
        : await downloadTo(store, username, post.displayUrl || post.thumbnailUrl, 'post');
      posts.push({ ...post, mediaFile });
    }
  }

  const stories = [];
  const storyChanged = [];
  if (!isPrivate && entry.trackStories && config.storiesActor) {
    try {
      const allStories = await fetchStories(username, config);
      const fresh = filterNewStories(allStories, entry.seenStories);
      const newOnes = [];
      for (const s of fresh.slice(0, 20)) {
        const mediaFile = await downloadTo(store, username, s.mediaUrl, 'story');
        if (mediaFile) {
          stories.push({ ...s, mediaFile });
          newOnes.push(s);
        }
      }
      if (newOnes.length) {
        store.updateProfile(username, { seenStories: rememberStories(entry.seenStories, newOnes) });
        storyChanged.push(...stories);
      }
    } catch (err) {
      console.warn(`[poller] stories for ${username} skipped: ${err.message}`);
    }
  }

  const normalized = { ...profile, profilePicFile, posts };
  const summary = summarize(normalized);
  const changes = diffProfiles(prev, { profile: summary, posts });
  for (const s of stories) {
    changes.push({ type: 'story', field: 'story', to: { timestamp: s.timestamp, highlightTitle: s.highlightTitle, mediaFile: s.mediaFile } });
  }
  const snapshot = {
    at: new Date().toISOString(),
    username,
    profile: summary,
    posts,
    stories,
    changes,
    changeCount: changes.length,
  };

  store.saveSnapshot(username, snapshot);
  store.updateProfile(username, { lastPolledAt: snapshot.at });
  return { snapshot, storyChanged };
}

export async function poll(store, config, { force = false } = {}) {
  const cfg = store.getConfig();
  const profiles = cfg.profiles || [];
  if (!profiles.length) {
    return { ok: false, skipped: true, message: 'No profiles configured yet.' };
  }
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN is not set. Add it to your .env or environment variables.');
  }

  const startedAt = new Date().toISOString();
  store.setConfig({ lastPollAt: startedAt, lastPollStatus: 'running', lastPollError: null });

  const now = Date.now();
  const results = [];
  let totalChanges = 0;
  let polledCount = 0;

  for (const entry of profiles) {
    const due = force || isDue(entry, config, now);
    if (!due) {
      results.push({
        username: entry.username,
        ok: true,
        due: false,
        nextPollAt: new Date(Date.parse(entry.lastPolledAt) + profileInterval(entry, config) * 60 * 60 * 1000).toISOString(),
      });
      continue;
    }
    try {
      const { snapshot, storyChanged } = await pollProfile(store, config, entry);
      polledCount += 1;
      totalChanges += snapshot.changeCount;
      results.push({
        username: entry.username,
        ok: true,
        due: true,
        at: snapshot.at,
        changeCount: snapshot.changeCount,
        changes: snapshot.changes,
        newStories: storyChanged.length,
      });
    } catch (err) {
      results.push({ username: entry.username, ok: false, due: true, error: err.message });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const okCount = results.length - failed;
  const status = failed === 0 ? 'ok' : okCount === 0 ? 'error' : 'partial';

  store.setConfig({
    lastPollStatus: status,
    lastPollError: failed > 0 ? `${failed} profile(s) failed` : null,
    nextPollAt: new Date(now + config.pollIntervalHours * 60 * 60 * 1000).toISOString(),
    totalSnapshots: (cfg.totalSnapshots || 0) + polledCount,
    totalChanges: (cfg.totalChanges || 0) + totalChanges,
  });

  return {
    ok: failed === 0,
    partial: status === 'partial',
    skipped: false,
    results,
    polledCount,
    totalChanges,
    nextPollAt: store.getConfig().nextPollAt,
  };
}
