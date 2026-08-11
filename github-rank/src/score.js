export function logScale(n) {
  return Math.log10(1 + Math.max(0, n));
}

export function recencyScore(isoDate, halfLifeDays = 180) {
  if (!isoDate) return 0;
  const days = (Date.now() - new Date(isoDate).getTime()) / 86400000;
  if (days < 0) return 1;
  return Math.pow(0.5, days / halfLifeDays);
}

export function fetchReposScore(github, query, maxRepos = 20) {
  const encoded = encodeURIComponent(query + ' fork:false');
  const limit = Math.max(1, Math.min(50, Number(maxRepos) || 20));
  const url = `https://api.github.com/search/repositories?q=${encoded}&sort=stars&order=desc&per_page=${limit}`;
  return github.get(url).then((data) =>
    data.items.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      owner: r.owner.login,
      name: r.name,
      description: (r.description || '').slice(0, 200),
      htmlUrl: r.html_url,
      language: r.language,
      topics: r.topics || [],
      stars: r.stargazers_count,
      forks: r.forks_count,
      watchers: r.subscribers_count,
      openIssues: r.open_issues_count,
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      license: r.license && r.license.spdx_id,
    })),
  );
}

export function asyncCollect(ctx, handler, raiseOnError = false) {
  const errors = [];
  return Promise.all(
    ctx.repos.map(async (repo, i) => {
      try {
        await handler(repo, i);
      } catch (err) {
        if (raiseOnError) throw err;
        errors.push(`${repo.fullName}: ${err.message || err}`);
      }
    }),
  ).then(() => errors);
}

export async function enrichWithPrActivity(ctx, maxPrs = 50) {
  const limit = Math.max(1, Math.min(100, Number(maxPrs) || 50));
  const errors = await asyncCollect(ctx, async (repo) => {
    const data = await ctx.github.get(
      `https://api.github.com/repos/${repo.fullName}/pulls?state=all&per_page=${limit}`,
    );
    let open = 0;
    let closed = 0;
    let merged = 0;
    let reviewComments = 0;
    let latest = null;
    for (const pr of data) {
      if (pr.state === 'open') open += 1;
      else closed += 1;
      if (pr.merged_at) merged += 1;
      reviewComments += Number(pr.review_comments) || 0;
      const t = new Date(pr.created_at).getTime();
      if (!latest || t > latest) latest = t;
    }
    repo.prs = { open, closed, merged, reviewComments, latestActivity: prLatest(latest) };
  });
  ctx.warnings = (ctx.warnings || []).concat(errors);
}

export function prLatest(ts) {
  return ts ? new Date(ts).toISOString() : null;
}

const DEF_WEIGHTS = {
  stars: 30,
  forks: 20,
  activity: 25,
  review: 25,
};

export function computeScore(repo, weights = DEF_WEIGHTS) {
  const stars = logScale(repo.stars) * weights.stars;
  const forks = logScale(repo.forks) * weights.forks;

  const issRate = clamp01(repo.openIssues / 1000);
  const activity = (recencyScore(repo.pushedAt, 150) * 0.55 + (1 - issRate) * 0.2 + recencyScore(repo.createdAt, 365 * 3) * 0.25) * weights.activity;

  const prs = repo.prs || { open: 0, closed: 0, merged: 0, reviewComments: 0, latestActivity: null };
  const prFlow = logScale(prs.merged + prs.closed) * 0.55 + logScale(prs.reviewComments) * 0.25 + recencyScore(prs.latestActivity, 60) * 0.2;
  const review = prFlow * weights.review;

  return {
    score: round2(stars + forks + activity + review),
    breakdown: {
      stars: round2(stars),
      forks: round2(forks),
      activity: round2(activity),
      review: round2(review),
    },
  };
}

export function sortByScore(repos) {
  return [...repos].sort((a, b) => b.score - a.score);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}