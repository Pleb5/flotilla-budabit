# Nostr Git Maintainer Model Synthesis

## Executive Summary

Nostr Git needs two things that pull against each other:

- Open, protocol-level discovery where no platform owns repo identity or collaboration.
- A consistent maintainer UX where ordinary users understand which repo they are working in, who maintains it, and where issues and pull requests should go.

The strongest synthesis from comparing Budabit and Gitworkshop is a layered model:

| Layer | Purpose | Recommended Direction |
| --- | --- | --- |
| Protocol layer | Preserve interoperability | Keep normal NIP-34 repo announcements, `a` tags, `p` tags, `relays`, `clone`, and repo state events. |
| Anchor layer | Give users a stable starting point | Use a **root maintainer** announcement as the entry point for a repo view. |
| Discovery layer | Keep Nostr open | Discover related maintainer announcements recursively, but bound traversal and make it transparent. |
| Working set layer | Give users consistent UX | Default UI should use a small **working maintainer set**, not an unbounded recursive graph. |
| Enforcement layer | Enforce real permissions | Git servers, GRASP servers, and relays decide what keys can push, publish, or update privileged repo state. |
| View/moderation layer | Provide best-effort client policy | Clients decide what to recommend, emphasize, hide, warn about, and treat as the default repo view. |

The product concept should not be "a selected maintainer as an entrypoint to an unbounded recursive repo universe." That is technically interesting but poor UX. The user-facing concept should be:

> This repo view starts from a root maintainer and uses a working maintainer set for day-to-day collaboration. Broader maintainer graph discovery remains available, but it does not destabilize the default repo view.

## Recommended Vocabulary

| Avoid | Prefer | Reason |
| --- | --- | --- |
| Selected maintainer | Root maintainer | Communicates the anchor role without sounding like a transient UI dropdown. |
| Recursive maintainer set | Maintainer graph | Frames recursion as discovery/context, not immediate authority. |
| Effective maintainers | Working maintainers | Easier product language for the people actively maintaining this repo view. |
| Requested maintainer | Pending maintainer | Easier to understand than protocol jargon. |
| Transitive maintainer | Discovered maintainer | Avoids implying full default powers. |

## Recommended Model

### Root Maintainer

The root maintainer is the pubkey in the repo announcement that anchors the current view:

```text
30617:<root-maintainer-pubkey>:<repo-d-tag>
```

The root maintainer usually comes from a route, naddr, search result, followed profile, or event context. It is not necessarily a global owner. It is the maintainer whose signed repo announcement is the starting point for this view.

### Working Maintainers

The working maintainer set should be the default UX set for ordinary collaboration:

- Root maintainer.
- Direct mutual maintainers listed by the root and listing the root back.
- Optional explicitly delegated maintainers if a later protocol/profile supports delegation.

Working maintainers are the people clients use for default buttons, issue/PR routing, repo state merging, notifications, and suggested moderation actions.

### Discovered Maintainers

Clients may recursively discover a larger mutual maintainer graph for migration hints, search, provenance, and context. This graph must be bounded by depth, node count, and time budget.

Discovered maintainers should not automatically become part of the default working set.

### Pending Maintainers

One-way links should be visible but non-default:

```text
A lists B, but B does not list A back.
```

Budabit should display these as pending/requested maintainers. They should not be included in default `a` tags, default `p` tags, or recommended maintainer actions.

### Removed or Blocked Maintainers

A pure recursive model has a revocation problem: if root maintainer A removes X, another maintainer B can reintroduce X through a transitive path.

For a practical MVP, root maintainer removal should win for the root-anchored view. Recursive discovery can still show that another maintainer lists X, but X should not silently re-enter the working set unless the root maintainer directly re-adds X or explicitly delegates that power.

## Event Tagging Policy

New repo activity should not tag an unbounded recursive graph.

Recommended default:

| Event tag | Include |
| --- | --- |
| `a` tags | Root repo address, current viewed repo address if different, and bounded working maintainer repo addresses. |
| `p` tags | Root maintainer, direct working maintainers, root event author, explicit assignees/reviewers/mentions. |

Do not emit `a` or `p` tags for every recursively discovered maintainer. If a maintainer graph has thousands of nodes, the client should summarize and cap it.

Suggested MVP caps:

| Cap | Suggested Value |
| --- | --- |
| Maintainer graph traversal nodes | 256 |
| Maintainer graph depth | 4 to 6 |
| `a` tags emitted on new issue/PR | 16 to 32 |
| `p` tags emitted on new issue/PR | 8 to 16 |
| Maintainers shown inline | 20 |

## GRASP and Server Enforcement

Clients do not enforce the hard boundary. A user can always use another client or command-line tool. The real enforcement happens at relays and git servers.

GRASP is important because it can connect Nostr identity to git operations:

| GRASP capability | UX value |
| --- | --- |
| Accept pushes from configured pubkeys | Real write permission. |
| Publish signed repo state | Clients can know accepted branch/tag tips. |
| Reject unauthorized pushes or updates | Hard enforcement boundary. |
| Advertise accepted maintainers/policy | Clients can align UI with server reality. |
| Mirror root/working-set conventions | Interop across Budabit, Gitworkshop, ngit, and other clients. |

Ideally, GRASP or a related policy event should make server reality visible:

```text
root maintainer: <pubkey>
working maintainers: <pubkey list>
accepted repo addresses: <30617 addresses>
policy updated at: <timestamp>
```

Clients can then show when the local working set differs from what a server will actually accept.

## Budabit Today

Budabit currently uses a conservative effective-maintainer model.

| Dimension | Budabit Today |
| --- | --- |
| Repo entrypoint | NIP-34 repo announcement address. |
| Maintainer tag | Parses `maintainers` from repo announcements. |
| Maintainer validation | A tagged maintainer becomes effective only if that pubkey also has a matching repo announcement for the same repo id and compatible EUC. |
| Recursive behavior | Not a full recursive maintainer graph. Mostly direct verification. |
| Event visibility | Repo views expand over effective repo address aliases client-side. |
| Event creation | Generally tags the current repo address and adds effective maintainers as `p` recipients. |
| Notifications | Uses effective repo addresses to match watched repo activity. |
| Strength | Safer, simpler, bounded by default. |
| Weakness | Less expressive for maintainer transitions and multi-maintainer repo infrastructure. |

Useful Budabit properties to keep:

- Conservative default trust.
- Effective repo address expansion for activity visibility.
- Notification mapping across effective aliases.
- Avoidance of unbounded graph expansion.

## Gitworkshop Today

Gitworkshop has a root-entrypoint style model currently called selected maintainer in discussion.

| Dimension | Gitworkshop Today |
| --- | --- |
| Repo entrypoint | Route/naddr resolves to `30617:<pubkey>:<identifier>`. This is the selected/root maintainer announcement. |
| Maintainer tag | Event author plus valid pubkeys in `maintainers`. |
| Discovery | Fetches repo announcements with the same identifier and recursively follows repo refs discovered from announcements and repo activity. |
| Event visibility | New issues tag all known maintainer repo refs as `a` tags, so work can appear across co-maintainer repo views. |
| Event authority in client view | Issue/PR status and label handling derives maintainer pubkeys from the event's repo `a` tags. |
| EUC handling | Reads earliest unique commit as metadata, but the central identity is maintainer plus `d` tag. |
| Strength | Better story for maintainer transitions, multi-maintainer visibility, and decentralized discovery. |
| Weakness | The raw recursive story is hard to explain, can be unbounded, and needs explicit mutual/pending/removal semantics to avoid confusing or unsafe views. |

Useful Gitworkshop properties to adopt carefully:

- Root maintainer as explicit view anchor.
- Multi-maintainer `a` tagging for visibility across ownership transitions.
- Recursive discovery as context, not necessarily default working authority.
- Unioning maintainer infrastructure such as `relays` and `clone` across trusted working maintainers.

## Comparison

| Topic | Budabit Today | Gitworkshop Today | Recommended Direction |
| --- | --- | --- | --- |
| Human-facing anchor | Implicit current repo address | Selected maintainer | Use root maintainer. |
| Maintainer graph | Direct, conservative | Recursive discovery | Recursive discovery should exist, but default UX should use bounded working set. |
| Co-maintainer verification | Requires matching announcement/EUC compatibility | Intended mutual graph; current code emphasizes recursive related refs | Use direct mutual for working set; pending for one-way links. |
| Event `a` tags | Usually current repo address | All known maintainer repo refs for issue creation | Tag root plus bounded working maintainer repo refs. |
| Event `p` tags | Effective maintainers | Maintainers from maintainer repo refs | Keep small and participant-oriented. |
| Ownership transitions | Conservative alias expansion | Better multi-tag transition support | Adopt bounded multi-`a` tagging. |
| Large graph risk | Low | Higher if recursive set is used literally | Cap traversal and tag emission. |
| Removal semantics | Root/direct verification limits reintroduction | Pure recursion can reintroduce removed maintainers | Root removals should prevent re-entry into root working set. |
| GRASP alignment | Present but still evolving | Git server integration is central to the story | Expose server policy and align client UI to it. |

## MVP Recommendation

Budabit should move toward this profile:

1. Rename the entrypoint concept to **root maintainer**.
2. Introduce a **working maintainer set** for default UX.
3. Keep recursive maintainer graph discovery as bounded context, not as the literal default authority or tagging set.
4. Treat one-way maintainer links as **pending maintainers**.
5. Emit bounded multi-`a` tags for root plus working maintainers so issues/PRs survive maintainer transitions.
6. Keep `p` tags smaller than `a` tags and focused on actual notification recipients.
7. Union `clone` and `relays` across working maintainers.
8. Let GRASP/git servers publish or expose accepted maintainer policy so clients can show server reality.
9. Prefer root/direct mutual maintainers for day-to-day buttons and recommendations.
10. Keep broader discovery open for users who want to inspect the wider graph.

The simplest story for users is:

> Your repo view starts from a root maintainer. Budabit uses that maintainer's working set for normal collaboration, while Nostr still lets anyone discover related announcements, forks, and maintainer transitions without a platform owning discovery.
