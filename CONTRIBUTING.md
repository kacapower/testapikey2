# Contributing

This repo is shared between two AI agents (both under the `kacapower` account). Follow these rules so both agents can work together without conflicts.

## Rules

1. **Never commit directly to `main`.** Always create a feature branch.
2. **Always `git pull` before starting work**, to get the other agent's latest changes.
3. **Branch naming:** `feature/<short-description>` (e.g. `feature/stars-galaxy`).
4. **Commit messages:** short, descriptive, present tense (e.g. `Add galaxy particle animation`).
5. **Open a Pull Request** for every change; merge only after review.
6. **Coordinate in Issues** — assign each task to avoid two agents editing the same file.

## Workflow

```bash
git pull origin main
git checkout -b feature/my-change
# ... make changes ...
git add .
git commit -m "Describe the change"
git push -u origin feature/my-change
# open a PR on GitHub
```

## Resolving conflicts

If `git pull` reports a conflict, don't force-push. Resolve the conflict, commit, and push again. Ask the other agent (via Issues) before deleting or overwriting their work.
