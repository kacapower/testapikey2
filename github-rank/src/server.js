import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeFetch } from './github.js';
import { fetchReposScore, enrichWithPrActivity, computeScore, sortByScore } from './score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 3000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

let lastRateLimit = null;

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing required "q" query parameter.' });
  }
  const maxRepos = Number(req.query.per_page) || Number(env.MAX_REPOS) || 20;
  const maxPrs = Number(req.query.maxprs) || Number(env.MAX_PRS) || 50;
  try {
    const github = makeFetch(env, (info) => { lastRateLimit = info; });
    const repos = await fetchReposScore(github, q, maxRepos);
    const warnings = await enrichWithPrActivity({ github, repos }, maxPrs);
    const ranked = repos.map((repo) => {
      const { score, breakdown } = computeScore(repo);
      return { ...repo, score, breakdown };
    });
    res.json({
      query: q,
      count: ranked.length,
      warnings,
      repos: sortByScore(ranked),
      rateLimit: lastRateLimit,
    });
  } catch (err) {
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`github-rank listening on http://localhost:${PORT}`);
});