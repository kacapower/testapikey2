import test from 'node:test';
import assert from 'node:assert/strict';
import { logScale, recencyScore, computeScore, sortByScore } from '../src/score.js';

test('logScale handles zero and large numbers', () => {
  assert.equal(logScale(0), 0);
  assert.equal(logScale(-5), 0);
  assert.ok(logScale(1000) > logScale(100));
});

test('recencyScore decays over time', () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 365 * 3 * 86400000).toISOString();
  assert.ok(recencyScore(now) > recencyScore(old));
  assert.equal(recencyScore(null), 0);
});

test('computeScore ranks an active repo above a stale but popular one', () => {
  const active = {
    stars: 1000,
    forks: 200,
    openIssues: 5,
    pushedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 2 * 365 * 86400000).toISOString(),
    prs: { open: 4, closed: 120, merged: 90, reviewComments: 300, latestActivity: new Date().toISOString() },
  };
  const stale = {
    stars: 5000,
    forks: 900,
    openIssues: 800,
    pushedAt: new Date(Date.now() - 3 * 365 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 8 * 365 * 86400000).toISOString(),
    prs: { open: 0, closed: 0, merged: 0, reviewComments: 0, latestActivity: null },
  };
  const a = computeScore(active).score;
  const b = computeScore(stale).score;
  assert.ok(a > b, `expected active (${a}) to outrank stale (${b})`);
});

test('computeScore returns a breakdown that sums to the score', () => {
  const repo = {
    stars: 100,
    forks: 30,
    openIssues: 10,
    pushedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    prs: { closed: 20, merged: 15, reviewComments: 40, latestActivity: new Date().toISOString() },
  };
  const { score, breakdown } = computeScore(repo);
  const sum = round2(breakdown.stars + breakdown.forks + breakdown.activity + breakdown.review);
  assert.equal(score, sum);
});

test('sortByScore orders descending', () => {
  const repos = [
    { score: 5 },
    { score: 9 },
    { score: 1 },
  ];
  assert.deepEqual(sortByScore(repos).map((r) => r.score), [9, 5, 1]);
});

function round2(n) {
  return Math.round(n * 100) / 100;
}