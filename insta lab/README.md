# Instagram Monitor

A password-locked app that watches **multiple Instagram profiles** and records **everything that changes** — profile picture, bio, display name, follower counts, website, new posts, and stories/highlights — polling periodically via the [Apify](https://apify.com) Instagram scraper actors.

- **Public profiles:** full details + posts are tracked. New posts are only kept if they were made *after* the profile was added (tick **Download previous posts** when adding to also backfill older ones).
- **Private profiles:** only the profile picture is fetchable, so the monitor tracks avatar changes only — and **batches** them to a slower cadence (`POLL_BATCH_HOURS`, default 6h) to save credits. The avatar is downloaded and stored by its content hash — each poll re-downloads it, and if the hash matches the saved image it is *rejected* (no duplicate saved); if the hash differs it is *saved* as a new image and logged as a change.
- **Stories & highlights:** each poll fetches current stories + highlights and immediately saves anything new (by story id, so the same story is never re-downloaded).
- **Custom intervals:** pick from 1, 2, 3, 4, 6, 8, 12 or 24 hours globally, or set a custom "every Xh" per profile (Auto falls back to the global interval, or the 6h batch for private accounts).
- **F1-style leaderboard:** standings table ranking profiles by activity (total changes, new posts, stories, avatar changes, follower growth) with a time-window picker (All-time / 7 / 30 days) and sortable columns.
- **Account navigation:** tabs at the top of the dashboard switch between "All" and each individual `@username`.
- **5 pages (sidebar):** Dashboard (stats + timeline), Leaderboard, Config (profiles, intervals, polling status, Telegram alerts), Data (storage usage, ZIP backups, 7-day retention, Hugging Face sync), and a media Gallery.
- **Profile rename:** rename a profile and the local media folder, history, and Hugging Face folder all follow the new name.
- **Data retention:** posts/stories media older than `RETENTION_DAYS` (default 7) are auto-deleted to save storage — avatars are never deleted and JSON history is always kept. You can download a full or per-profile ZIP backup before they age out.
- **Hugging Face backup:** after every poll, each person's data is pushed to your dataset as a folder per person (`<user>/profile.json`, `<user>/history.json`, `<user>/media/*`). Failed uploads retry on the next poll. Runs entirely via your `HF_TOKEN`.
- **Telegram alerts:** get a message when a tracked profile changes, plus a configurable daily summary — sent to one or more chat/user IDs via your bot token.
- **Dark / light mode:** follows your system theme automatically.
- All data is stored locally on the host under `data/` (JSON snapshots + downloaded images).
- The dashboard is locked behind a password you set on first run.
- Runs anywhere: locally, or free on Render/Railway/Fly with the included hourly GitHub Actions cron.

## How it works

```
GitHub Actions cron (hourly)
   │  POST /api/poll   (x-poll-token)
   ▼
Express server ──► Apify actor(s)
   │   apify/instagram-scraper         → profile + latest posts
   │   oneary/instagram-stories-…      → stories + highlights (if enabled)
   ▼
Private? ──► batched (6h) ──► avatar only ──► download → hash → same as saved? reject : save as change
   │
   ▼
Change detection (diff vs. last snapshot) ──► save snapshot + download new media
   ▼
Password-locked web dashboard (account tabs, before/after avatars, new posts, saved stories)
```

## 1. Run locally

```bash
cd instagram-monitor
npm install
cp .env.example .env        # add your APIFY_TOKEN
npm start                   # http://localhost:3000
```

Open the site, set a password, then add Instagram usernames or profile links (e.g. `@natgeo`, `https://instagram.com/natgeo`). Untick **Download previous** to only track posts made after today. Pick a poll interval and hit **Save interval**, then **Run poll now**. You can add and remove profiles at any time; private profiles are tracked for avatar changes only and are checked on a slower 6-hour batch.

> **Apify token:** free at https://console.apify.com → Account → Integrations → API token.
> The default actor is the official `apify/instagram-scraper`. It works without login for public profiles and returns the profile card (avatar, bio, counts) for private accounts. It is **pay-per-result**: the free plan includes ~300 results/month, then ~$2.70 per 1,000 results. One poll of a profile with 12 recent posts costs ~13 results, so hourly polling of a few profiles adds up — set `POLL_INTERVAL_HOURS` higher (and leave private accounts on the 6h batch) to stay within the free allowance.
> **Stories** use a separate actor (`oneary/instagram-stories-and-highlights-scraper`) which requires Apify's **RESIDENTIAL proxy** (pay-per-GB, ~$0.45/GB) — Instagram blocks its default proxy. Leave `APIFY_STORIES_ACTOR` empty to disable story tracking entirely.

## 2. Deploy free + always polling

The app's own scheduler runs while the server is up. Free hosting often sleeps idle instances, so the **GitHub Actions cron** is what keeps it uninterrupted — it wakes the service and triggers a poll every hour.

1. **Deploy the app.** The easiest free option is [Render](https://render.com) using the included `render.yaml` (Blueprints → New blueprint → select this repo's `instagram-monitor/render.yaml`). You'll be asked to set the `APIFY_TOKEN` value. Any always-on host works (Railway, Fly.io, a Raspberry Pi, etc.).
2. **Add the cron to your repo.** Copy `.github/workflows/poll.yml` into your repo root and set two secrets/vars:
   - Repo secret `POLL_TOKEN` = the value you set on the host.
   - Repo variable `MONITOR_URL` = your deployed site URL (e.g. `https://instagram-monitor.onrender.com`).
3. The workflow runs every hour on the hour. You can also run it manually (Actions → hourly-poll → Run workflow).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `APIFY_TOKEN` | *(required)* | Apify API token |
| `APIFY_ACTOR` | `apify/instagram-scraper` | Apify actor used to scrape the profile |
| `APIFY_STORIES_ACTOR` | *(empty = off)* | Actor for stories/highlights (`oneary/instagram-stories-and-highlights-scraper`) |
| `APIFY_STORIES_PROXY` | *(empty)* | Proxy group for the stories actor (`RESIDENTIAL` works) |
| `INSTAGRAM_SESSION` | *(optional)* | Login cookie for actors that need it |
| `HF_TOKEN` | *(empty = off)* | Hugging Face token for dataset backups |
| `HF_DATASET` | *(empty)* | Dataset repo id, e.g. `yourname/instagram-monitor` |
| `TELEGRAM_BOT_TOKEN` | *(empty = off)* | Bot token for change alerts + daily summary |
| `TELEGRAM_USER_IDS` | *(empty)* | Comma-separated chat/user IDs to send alerts to |
| `RETENTION_DAYS` | `7` | Delete media older than this (avatars + JSON always kept) |
| `SUMMARY_HOUR` | `9` | Hour (0–23) for the daily Telegram summary |
| `SECRET` | dev value | Signs login cookies; set a long random string |
| `POLL_TOKEN` | dev value | Allows the external cron to trigger polls |
| `POLL_INTERVAL_HOURS` | `1` | Default poll interval for public profiles |
| `POLL_BATCH_HOURS` | `6` | Slower interval private accounts are checked on |
| `PORT` | `3000` | Web port (hosts set this) |
| `DATA_DIR` | `./data` | Where snapshots + media are stored (must be persistent on the host) |

## Security notes

- Passwords are stored as salted scrypt hashes; sessions use HMAC-signed HttpOnly cookies.
- `/api/status` hides the tracked username until you log in; all data and media endpoints require the password.
- On Render free, the instance shuts down when idle — the cron wakes it for each poll. If you use the built-in scheduler only, deploy somewhere always-on.
- Keep `POLL_TOKEN` and `SECRET` out of the repo (use host env vars / GitHub secrets).

## API

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /api/status` | public (profile list hidden) | Locked state, tracked profiles, poll status |
| `POST /api/setup` | first run only | Set the password |
| `POST /api/login` / `logout` | public | Login / logout |
| `POST /api/config` | password | Set the poll interval |
| `POST /api/config/profiles` | password | Add a profile (`username`, `backfill`, `trackStories`) |
| `PATCH /api/config/profiles/:username` | password | Toggle `backfill` / `trackStories` / set `intervalHours` (null = auto) |
| `POST /api/config/profiles/:username/rename` | password | Rename a profile (media, history, HF folder follow) |
| `DELETE /api/config/profiles/:username` | password | Stop tracking a profile |
| `POST /api/poll?force=1` | password **or** `x-poll-token` | Trigger a poll (only due profiles unless `force=1`) |
| `GET /api/backup` / `/api/backup/:username` | password | Download full or per-profile ZIP backup |
| `GET /api/data/usage` | password | Storage usage per profile |
| `POST /api/data/cleanup` | password | Delete old media now (respects retention) |
| `POST /api/hf/sync` | password | Push data to Hugging Face now |
| `POST /api/alerts/test` | password | Send a test Telegram message |
| `GET /api/media/all` | password | List all media for the gallery |
| `GET /api/history` | password | All snapshots & changes |
| `GET /api/media/:username/:file` | password | Saved images (avatars, posts, stories) |

## Tests

```bash
npm test
```

Coverage: password hashing/verification, session tokens/cookies, the profile change-diff logic (avatar, fields, new/removed posts), and the multi-profile store (add/remove/dedupe + legacy config migration).