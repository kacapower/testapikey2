import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function requireSecretInProd(name, value) {
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is not set. Refusing to start in production with an insecure default — ` +
        `set ${name} in your environment (e.g. Render dashboard env vars).`
    );
  }
  return value || `dev-${name.toLowerCase()}-change-me`;
}

export function loadConfig() {
  return {
    port: Number(process.env.PORT) || 3000,
    // In production these MUST come from real env vars — falling back to a
    // hardcoded default would let anyone guess the poll token (to trigger
    // /api/poll) or forge session cookies signed with a known secret.
    secret: requireSecretInProd('SECRET', process.env.SECRET),
    pollToken: requireSecretInProd('POLL_TOKEN', process.env.POLL_TOKEN),
    apifyToken: process.env.APIFY_TOKEN || '',
    apifyActor: process.env.APIFY_ACTOR || 'apify/instagram-scraper',
    storiesActor: process.env.APIFY_STORIES_ACTOR || '',
    storiesProxy: process.env.APIFY_STORIES_PROXY || '',
    instagramSession: process.env.INSTAGRAM_SESSION || '',
    pollIntervalHours: Number(process.env.POLL_INTERVAL_HOURS) || 1,
    batchIntervalHours: Number(process.env.POLL_BATCH_HOURS) || 8,
    retentionDays: Number(process.env.RETENTION_DAYS) || 7,
    hfToken: process.env.HF_TOKEN || '',
    hfDataset: process.env.HF_DATASET || '',
    renderApiKey: process.env.RENDER_API_KEY || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramUserIds: (process.env.TELEGRAM_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    summaryHour: Number(process.env.SUMMARY_HOUR) || 9,
    dataDir: process.env.DATA_DIR || path.join(rootDir, 'data'),
    publicDir: path.join(rootDir, 'public'),
  };
}

export const CONFIG_FILE = 'config.json';
export const PASSWORD_FILE = 'password.json';
export const HISTORY_FILE = 'history.json';
export const MEDIA_DIR = 'media';
export const HF_MANIFEST_FILE = 'hf-manifest.json';
