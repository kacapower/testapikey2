# GitHub Repo Rank

Find GitHub repositories of a specific type (topic, language, keyword) and rank them by
**stars, forks, maintenance activity, and review activity** — so a well-maintained project
outranks an abandoned-but-popular one.

## What it does

1. Search GitHub for a query (`LLM agent framework`, `invoice OCR`, `topic:vector-database`) and pulls the top ~20 results by stars.
2. For each repo, inspects its recent pull requests and counts **open / closed / merged PRs**, **review comments**, and PR recency.
3. Computes a **composite score** per repo:
   - **Stars** (log-scaled, weight 30)
   - **Forks** (log-scaled, weight 20)
   - **Activity** (weight 25): recency of last push, backlog (open issues), repo age
   - **Review activity** (weight 25): merged/closed PR flow, review comments, PR recency
4. Renders a ranked table (score + per-metric breakdown) with sortable columns and example chips.

## Run locally

```bash
cd github-rank
npm install
cp .env.example .env   # optional: add a GITHUB_TOKEN
npm start              # http://localhost:3000
```

## Deploy on Render (free)

1. Push this repo to GitHub.
2. [Render](https://render.com) → **Blueprints → New Blueprint** → select the repo → pick `github-rank/render.yaml`.
3. Set `GITHUB_TOKEN` (optional but recommended) — a classic "repo" PAT from <https://github.com/settings/tokens>.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | *(empty)* | GitHub PAT. Unauthenticated = 10 searches/min; with token = 30 searches/min + 5,000 requests/hr |
| `MAX_REPOS` | `20` | How many top repos to fetch and rank per search |
| `MAX_PRS` | `50` | Recent pull requests inspected per repo for review metrics |
| `PORT` | `3000` | Web port (Render sets this) |

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/search?q=<query>&per_page=20` | Search + rank. Returns `{ repos: [{ fullName, stars, forks, score, breakdown, prs, … }], warnings, rateLimit }` |
| `GET /api/health` | Liveness check |

## Tests

```bash
npm test
```

## Notes

- Review metrics are computed from a *sample* of recent PRs (per_page-limited), so merged/review
  counts are relative indicators, not exhaustive totals.
- Repos that fail the PR fetch (e.g. private) are still ranked with scan+forks+activity; they're
  listed under `warnings`.
- Without a `GITHUB_TOKEN`, search results are limited by GitHub's unauthenticated rate limits.