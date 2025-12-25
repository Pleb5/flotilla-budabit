# NIP-34 / NIP-22 / NIP-32 Test Skeletons

This document outlines focused unit tests to implement. Each section lists scenarios and expected behavior. These can be translated into actual tests (Vitest/Jest) later.

## Repositories: groupByEuc and maintainers
- Input: multiple 30617 with same `r:euc`, various `d`, `web`, `clone`, `relays`, `maintainers`.
- Expect: deduped arrays and union of maintainers.
- Edge: missing `r:euc` events ignored.

## Repo State Merge: mergeRepoStateByMaintainers
- Input: 30618 events from maintainers and non-maintainers.
- Expect: only maintainer updates considered; per-ref take most recent by `created_at`.
- Edge: HEAD tag precedence over older refs.

## Patch DAG: buildPatchGraph
- Input: 1617 events with `e` parent edges and `t:root`, `t:root-revision` tags.
- Expect: children links computed; flags set; isolated nodes handled.

## Issues and Comments: assembleIssueThread
- Input: 1621 issue root, comment events referencing it using NIP-22 scoped tags.
- Expect: comments associated; duplicates deduped; scope respected.

## Status Precedence: resolveStatus
- Input: 163x statuses from maintainer vs non-maintainer across time.
- Expect: maintainer > non-maintainer; recency within role; kind order Draft < Open < Applied < Closed.

## Labels: effectiveLabelsFor and nip32 helpers
- Input: self labels via `l` and `L` on a target event; external label events; `t` tags.
- Expect: normalized labels include namespaced `L`/`l` and `t/<value>`; ordering not strict but deduped.

## Canonical Repo Keys: canonicalRepoKey and warnIfLegacyRepoKey
- Input: npub+name, npub only, legacy-like ids.
- Expect: formats `npub/name` or `npub`; warning on legacy key patterns.
