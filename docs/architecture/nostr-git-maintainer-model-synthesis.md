# Nostr Git Maintainer Model Synthesis

## Current Budabit Direction

Budabit no longer treats repositories as merged maintainer graphs. A repo announcement is its own product object:

```text
30617:<repo-author-pubkey>:<repo-d-tag>
```

The repo author plus the pubkeys in that announcement's `maintainers` tag are the repo maintainers Budabit uses for UI authority, status resolution, notifications, and publish recipients.

## Why

Recursive or mutually declared maintainer graphs are useful for protocol discovery, but they create unstable product identity:

- Multiple people can publish the same repo name or `d` tag.
- One announcement can imply another announcement, which can imply more announcements.
- Removal and conflict semantics become hard to explain.
- Issues and PRs can end up tagged to many repo addresses even though the user thinks they are working in one repo.

Budabit's product model is simpler:

> One repo view is anchored to one NIP-34 repo announcement address.

Other announcements with the same name, `d` tag, EUC, clone URL, or maintainer tags are separate repos, forks, mirrors, or collisions. Budabit may show helpful context later, but it does not merge them into app state.

## Event Policy

Budabit-authored repo activity uses the current repo address only:

| Event tag | Include |
| --- | --- |
| `a` tags | The current repo address. |
| `p` tags | Repo author, tagged maintainers, explicit assignees/reviewers/mentions, and active participants where useful. |

Budabit still tolerates events from other clients that contain many `a` or `p` tags. In a repo view, an event belongs when one of its `a` tags matches the current repo address. Extra tags are compatibility/context, not identity.

## Maintainers

Repo maintainers are derived from one announcement:

1. The `kind:30617` event author.
2. Valid pubkeys in that event's `maintainers` tag.

There is no pending-maintainer state in Budabit's default repo UX. If a listed maintainer has not published their own matching announcement, that does not matter for this repo's authority model.

### Verified Maintainer UI

Budabit also derives a repo-scoped verified maintainer display signal. This is not a separate authority role and does not grant permissions. It is only explanatory UI for maintainers who have already demonstrated owner-accepted collaboration in the current repo.

A declared maintainer is shown as verified for a repo when all of the following are true:

1. The pubkey is currently listed in the repo announcement `maintainers` tag.
2. The pubkey authored at least one pull request event for the current repo address.
3. The repo owner authored an applied/merged status event (`kind:1631`) for that pull request root.

The repo owner is not shown as a verified maintainer. If a maintainer is removed from the current repo announcement, the verified display disappears even if historical owner-merged PRs remain.

Verified maintainer indicators are repo-scoped. They can appear on repo overview maintainer chips, repo cards, profile links/avatars rendered from repo contexts, and profile modals opened from those contexts. Generic profile/community surfaces should not show this signal without explicit repo context.

## Infrastructure

Clone URLs, web URLs, and relays come from the current repo announcement and normal route/relay hints. Budabit does not union infrastructure across other maintainers' announcements.

GRASP or Git servers remain the hard enforcement layer for push access. Budabit's client-side maintainer logic is only UI and event-authority policy.

## Community Pivot Compatibility

This direct repo model is compatible with the community pivot:

- Repos without `h` tags can still be displayed as normal NIP-34 repos.
- Budabit community repos can add `h = <community-pubkey>` to make the community context explicit.
- Community repo lists can query `kind:30617` with `#h`.
- Child events still use the repo's normal NIP-34 `a` address.

If multi-community repo targeting becomes necessary later, it can be added as an explicit layer. It should not be the foundational repo identity model.
