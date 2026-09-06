---
name: Budabit Browser Verify
description: Verify Budabit Svelte UI changes and /git or PR reproductions using the isolated browser-verify workflow. Covers port 1847, workspace watchers, meaningful readiness, warm/cold caches, relay fixtures, and safe test identities.
---

# Budabit browser verification

Load `browser-verify` for the general workflow and helper safety rules. Keep verification targeted; this skill is not a request to crawl the whole app or publish anything.

If the global skill/helper is unavailable on another contributor's machine, report that limitation and use the appropriate existing focused tests. Do not auto-install tools or attach to a personal browser to work around missing setup.

## Correct development stack

- Default URL is `http://localhost:1847` (`vite.config.ts`), unless the current worktree has an explicitly identified alternate server. Stick to one hostname: localhost and 127.0.0.1 are separate browser origins/storage.
- Reuse the existing **full `pnpm dev` stack** when it belongs to the intended checkout. `package.json`'s `dev:full` first builds `@nostr-git/core` and `@nostr-git/ui`, then runs their watchers alongside Vite.
- Both Git packages export built `dist` output. Confirm the watchers have incorporated the changed source; a Vite page alone does not establish that the Git code is current. Do not substitute `pnpm dev:app` unless those outputs/watchers are already current.
- Do not kill another session's dev server or mutate unrelated in-progress work just to verify your change. If a different checkout owns port 1847, identify an explicit alternate port rather than silently testing the wrong application.

## Choose the check

- Ordinary iteration: warm dedicated profile, affected route, one meaningful user flow, and relevant desktop/mobile viewport. Keep the browser running through the edit/verify loop.
- Cold start, auth hydration, repository cache, offline, and PWA/service-worker changes: add a **separate cold or purpose-built check**. Warm success does not cover them. Do not blanket-disable service workers and claim offline/PWA coverage.
- Existing `tests/e2e/helpers/mock-relay.ts` and fixture helpers provide deterministic relay behavior in Playwright. Keep using focused tests for those cases initially; they are not automatically portable to raw CLI init scripts. Do not invent live signing credentials or reimplement the mocks for a one-off check.
- Use live relay/Git traffic only where the behavior being checked requires it. Public-service latency or unavailable Git content is a blocker to report, not a reason to wait indefinitely or declare a pass.
- Local UI changes do not authorize signing, publishing Nostr events, merging PRs, deleting data, making payments, or exporting personal browser state. Use a disposable test identity where authentication is necessary; stop for authorization if an operation would have real side effects.

## Meaningful results

- Wait for an expected enabled control, loaded result, or scoped app state. Avoid generic `networkidle`, whole-body substring heuristics, and fixed sleeps on this relay-driven app.
- For `/git/.../prs/...`, wait for review data and an enabled Analyze control before clicking. Verify the actual merge-analysis result; distinguish a legitimate conflicts verdict from a failed analysis.
- The `Merge analysis` heading in `src/app/components/PRView.svelte` exists before a result. Its presence is not success. `Retry Analyze` can indicate an error. Merely losing `Analyzing...` is not a result assertion either.
- Derive selectors/readiness from the **current** code and page. Do not hard-code a PR ID, commit count, outcome, or hypothetical window-level readiness hook as a universal check.
- Budabit uses Svelte. Do not enable React/Next.js introspection or use history manipulation as a substitute for testing actual Svelte navigation.
- Use snapshot text to inspect content and the `read` tool to examine task-relevant PNGs for layout, overflow, clipping, and overlays. There is no desktop capture or access to your personal browser in this workflow.

## Focused automated fallback

Run only the relevant existing test when appropriate, for example:

```sh
pnpm exec playwright test --project=chromium tests/e2e/repo-cache-offline.spec.ts
```

This example is for repository-cache behavior, not a mandatory command for every task. For changed pure logic, use the appropriate targeted Vitest test instead. Check current configuration before choosing a test project; do not run all overlapping projects by default.

## Evidence

Report the checkout/server, route, expected and observed behavior, warm/cold and mocked/live state, timings, relevant new errors, and artifact paths. Explicitly identify missing first-load, auth, offline, visual, or real-service coverage. Do not call an unviewed screenshot visual verification. Close only the task's warm/cold browser sessions at the end; preserve the app server and unrelated user work.
