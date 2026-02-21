# GitHub Issue Lifecycle Protocol

This document defines the procedure for Claude when addressing GitHub issues.

## Phase 0: Workspace Isolation

Each session MUST use `git worktree` to prevent conflicts with simultaneous modifications.
- Create a new worktree in a temporary directory for the duration of the task.
- Remove the worktree on completion or session termination.

## Phase 1: Exploration & Understanding

Before proposing changes, understand the codebase:
- Use Grep/Glob to locate relevant components, logic, and tests.
- Read existing patterns, styling, and dependencies.
- Identify test and lint commands (`npm test`, `npm run lint`).

## Phase 2: Implementation & Local Verification

1. **Develop** on a descriptive feature branch (never commit directly to `main`).
2. **Verify** locally:
   - Run unit tests.
   - Run linting.
   - Perform basic smoke tests on the affected area.
3. **Iterate** until all checks pass.

## Phase 3: Pull Request & Staging

1. **Open a PR** targeting `main`, using `Fixes #N` or `Closes #N` keywords in the PR body so GitHub auto-closes the issue on merge (e.g. "Fixes #123").
2. **Staging auto-deploys**: `deploy-staging.yaml` triggers automatically and posts a comment on the PR with the staging URL:
   `https://tommyroar.github.io/intentcity/staging/`
3. **Wait for review**: Push new commits to the same branch in response to feedback. **Do NOT merge** — keep the PR open until the human maintainer merges it.

## Phase 4: Production & Closure

1. After the human merges to `main`, `deploy-spa.yaml` triggers automatically.
2. Verify the fix at `https://tommyroar.github.io/intentcity/`.
3. Close the issue only after confirming the production deployment succeeded.
