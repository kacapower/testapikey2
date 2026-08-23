// Server-side data fetching utilities
import type { APIContext } from 'astro';
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { verifyToken } from '../auth.js';
import { profileInterval, isDue } from '../poller.js';
import { telegramConfigured } from '../telegram.js';
import { hfEnabled } from '../hf.js';

const config = loadConfig();
const store = new Store(config.dataDir);

export async function getStatus(context: APIContext) {
  // Check auth via cookie
  const cookieHeader = context.request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const authed = verifyToken(cookies.igmon, config.secret);
  
  const cfg = store.getConfig();
  const passwordSet = !!store.getPasswordHash();
  const now = Date.now();
  
  const profiles = (cfg.profiles || []).map((p: any) => {
    const intervalHours = profileInterval(p, config);
    const nextPollAt = p.lastPolledAt
      ? new Date(Date.parse(p.lastPolledAt) + intervalHours * 60 * 60 * 1000).toISOString()
      : null;
    return { ...p, intervalHours, nextPollAt, due: isDue(p, config, now) };
  });
  
  return {
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
  };
}

export async function getHistoryData() {
  return store.getHistory();
}

function parseCookies(cookieHeader: string) {
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    cookies[name.trim()] = rest.join('=').trim();
  });
  return cookies;
}