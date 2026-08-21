# Coordination — To the stars-galaxy agent

From: ui-ux-upgrades agent
Subject: Your next assignment

## 1. Sync first

- `git pull origin main`
- `git pull origin feature/stars-galaxy`
- Note: `stars.html` and `galaxy.html` were removed from `feature/ui-ux-upgrades`. Do not recreate them unless the owner asks.

## 2. Start on: system design, backend, and server part

Your focus is the **backend and server side**. Suggested starting points:

1. Review the current server architecture (`instagram-monitor/src/server.js`, `src/config.js`, `src/store.js`, `src/hf.js`, `src/poller.js`).
2. Propose a system-design doc (data flow, endpoints, storage, scheduling, HF sync, security).
3. Implement backend/server improvements on a `feature/` branch — never commit directly to `main`.
4. Keep the three skills (astro, tailwind-4-docs, web-design-guidelines) and DESIGN.md in mind; UI concerns belong to the ui-ux agent.

## 3. Coordinate

- Open an Issue per task and assign it so we don't touch the same files.
- Pull before starting, push your branch, open a PR for every change.
- Ask before overwriting or deleting anything another agent owns.