# Repo Rules — how to do anything here

This file is read automatically by agents on every open. Follow it always.

## 1. Skills to use for any work

Always use these three skills for every task in this repo:
- `astro`
- `tailwind-4-docs`
- `web-design-guidelines`

## 2. Design rules

- `DESIGN.md` at the repo root is the design-system contract. Read it before any UI/design work and follow it exactly (DM Sans only, black dominant CTA, brand colors only for product identity, rounded-full pills, 80px hero with -2px tracking, leading >= 1.10, flat-with-borders cards, no gradients on standard buttons).

## 3. Agent roles (two agents share this repo, both under `kacapower`)

- **ui-ux-upgrades agent** — UI/UX, frontend, dashboard, visual polish. Branch: `feature/ui-ux-upgrades`.
- **stars-galaxy agent** — system design, backend, server. Branch: `feature/stars-galaxy`.
- Never edit files owned by the other agent's area without asking first.

## 4. Contribution rules (from CONTRIBUTING.md)

1. Never commit directly to `main`. Always use a `feature/<short-description>` branch.
2. Always `git pull` before starting work (get the other agent's latest changes).
3. Commit messages: short, descriptive, present tense (e.g. `Add galaxy particle animation`).
4. Open a Pull Request for every change; merge only after review.
5. Coordinate in Issues — assign each task so two agents never edit the same file.
6. Never force-push. If `git pull` conflicts: resolve, commit, push. Ask before deleting/overwriting another agent's work.

## 5. How to run & test each app

### instagram-monitor (backend + dashboard)
```bash
cd instagram-monitor && npm install
cp .env.example .env        # add APIFY_TOKEN
npm start                   # http://localhost:3000
npm test                    # run tests (node --test)
npm run poll                # trigger a poll manually
```
- Env vars: see `instagram-monitor/README.md`. API endpoints listed there.
- Data stored under `data/`; HF backup to the configured `HF_DATASET`.

### github-rank
```bash
cd github-rank && npm install && npm start   # http://localhost:3000
npm test
```
- Optional `GITHUB_TOKEN` in `.env` raises rate limits.

### port-redirect-app
- Static `index.html`; open directly or serve statically.

## 6. Dataset sync (persistence)

After every major change, push all created folders/files to the linked dataset:
```bash
cd /home/node && python3 -c "import sync; sync.push_to_dataset()"
```
The dataset `kacapower/opencode` persists workspace, global config, skills, and chats across Space restarts.

## 7. Golden rules

- No secrets in the repo (`.env`, tokens stay in host env vars / GitHub secrets).
- Match existing style; don't add unrelated changes in the same commit.
- Verify with `npm test` (and lint if present) before opening a PR.