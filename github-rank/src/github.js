export function makeFetch(env = process.env, onRateLimit = null) {
  const token = env.GITHUB_TOKEN;
  return {
    get(url) {
      return fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'github-rank',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).then(async (res) => {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
        if (onRateLimit) onRateLimit({ remaining, reset });
        if (res.ok) return res.json();
        if (res.status === 403 || res.status === 429) {
          const wait = Math.max(0, reset - Date.now());
          if (wait > 1000) await new Promise((r) => setTimeout(r, Math.min(wait, 9000)));
          throw new Error('GitHub API rate limit hit; please set a GITHUB_TOKEN for higher limits');
        }
        const body = await res.text().catch(() => '');
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 160)}`);
      });
    },
  };
}