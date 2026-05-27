# Web of Trust in BudaBit Communities

## Purpose

BudaBit's web of trust should reflect how the application now works: users collaborate through Communikey communities, not through a general-purpose social graph. Trust decisions should therefore be rooted in community membership, community roles, section grants, repo-community associations, and community moderation state.

Social Nostr signals remain useful because users may carry valuable context from other clients. They should help with discovery and ordering, but they must not define who is trusted inside BudaBit communities.

## Policy Summary

| Policy | Decision |
| --- | --- |
| Primary trust source | Communikey communities defined by kind `10222` and their referenced kind `30000` profile lists. |
| Social graph depth | Direct only. Do not calculate a 2-hop follows-of-follows graph for BudaBit trust. |
| Direct follows | Small positive discovery/order signal. |
| Direct mutes | Small negative discovery/order signal, not a hard veto. |
| Reports | Community-contextual negative signal from current admins and moderators; report penalty weighs twice a mute. |
| Report reasons | Any reason counts. Trust policy should not special-case only `spam`. |
| Community bans | Conspicuous and contextual. Suppress community-bound content in that community, but do not create global distrust. |
| Overlay cap | Direct follows, mutes, and report penalties must not outweigh even the weakest valid community-based score. |
| UI output | Show semantic connections and counts, never raw compound trust scores. |
| NIP-85 | Currently unused and gated. |

## Why Direct Social Signals Are Enough

The previous Welshman-derived graph used kind `3` follows and kind `10000` mutes to build a 2-hop network. That model fits social clients better than BudaBit's current community-first product.

| Concern | 2-hop social WoT | Direct-only social overlay |
| --- | --- | --- |
| Performance | Requires loading many follows and mutes for many followed users. Hundreds of follows can fan out into large relay requests. | Requires only the viewer's direct lists and relevant community data. |
| Explainability | Hard to explain why a user was ranked or trusted. | Easy to explain with labels like `You follow` or `Muted by you`. |
| Product fit | Biases toward social-media popularity and relationships outside BudaBit. | Keeps social context as a weak personal signal. |
| Abuse surface | Large social graphs can import off-topic popularity or drama. | Lower blast radius and clearer provenance. |
| UI semantics | Usually collapses into opaque numeric trust. | Supports concrete badges and counts. |

Direct follows are useful because the viewer intentionally expressed interest in that person. Direct mutes are useful because the viewer intentionally expressed friction with that person. Neither signal should decide software collaboration trust on its own.

## Trust Sources

| Source | Nostr data | Scope | Role in trust |
| --- | --- | --- | --- |
| Community definition | Kind `10222` authored by the community pubkey | Community | Defines sections, relays, and profile-list refs. |
| Profile lists | Kind `30000` referenced by a community definition | Community section | Defines moderators and members/grantees. |
| Admin role | Community definition author | Community | Strongest community authority. |
| Moderator role | Owner of a referenced profile list with loaded evidence | Community section | Strong community authority for grants, reports, and repo associations. |
| Member/grantee role | Pubkey listed in a referenced profile list | Community section | Basic community participation and write-access evidence. |
| Repo association | Community targeting/association event such as kind `30222` for a repo | Repo plus community | Gives a repo a community trust context. |
| Direct follow | Viewer kind `3` list | Viewer personal | Small positive discovery/order signal. |
| Direct mute | Viewer kind `10000` list | Viewer personal | Small negative discovery/order signal. |
| Community report | Effective report from current admin/moderator | Community | Negative contextual moderation evidence. |
| Community ban | Effective person report/ban in a community | Community | Suppresses community-bound content and strongly degrades context-specific trust. |

## Trust Layers

Trust should be assembled in ordered layers. Higher layers decide whether content is personally or community relevant before weaker overlays are considered.

| Priority | Layer | Examples | Intended effect |
| --- | --- | --- | --- |
| 1 | Personal ownership and stars | Repos owned by viewer, repos starred by viewer | Always rank first in repo discovery. |
| 2 | Repo community context | Repo associated with the active or selected community | Uses the associated community as the strongest trust context for that repo. |
| 3 | Community role evidence | Admin, moderator, member, section grant | Main trust graph for BudaBit collaboration. |
| 4 | Community moderation evidence | Reports, event censors, person bans | Degrades or suppresses trust inside the relevant community. |
| 5 | Direct social overlay | You follow, muted by you | Helps with discovery and ordering only. |
| 6 | Known repository fallback | Known repo owners from loaded events | Discovery fallback with no trust claim. |

## Community Role Policy

Community roles are the core positive trust evidence.

| Evidence | Minimum meaning | Suggested internal strength | Human label examples |
| --- | --- | --- | --- |
| Viewer | The logged-in user | Highest personal baseline | `You` |
| Community admin | Target authored the relevant kind `10222` definition | Very strong | `Community admin` |
| Section moderator | Target owns a loaded profile list referenced by a section | Strong | `Moderator`, `Repo moderator` |
| Community member/grantee | Target appears in a referenced profile list | Basic community trust | `Community member`, `Can participate` |
| Shared section | Viewer and target can write in the same section | Small additive context | `Shared Repositories section` |
| Multiple shared communities | Viewer and target overlap in more than one community | Diminishing additive context | `3 shared communities` |

The weakest valid community role must be stronger than the strongest possible aggregate social overlay. This ensures social-media relationships cannot outweigh community membership or grants.

## Bounded Overlay Policy

Direct social signals are personal context, not BudaBit trust. Community reports are moderation evidence, not social gossip. Both kinds of overlay can affect ordering or contextual degradation, but they must remain bounded so they do not outweigh basic community evidence.

| Signal | Suggested unit | UI label | Notes |
| --- | --- | --- | --- |
| Viewer directly follows target | `+1` | `You follow` | Positive discovery/order signal. |
| Viewer directly mutes target | `-1` | `Muted by you` | Negative ordering signal, not a veto. |
| Relevant community report | `-2` | `Reported here` or `Moderation reports` | Weighs twice a mute. Applies in the report's community context. |
| Overlay cap | Absolute value below basic community membership | Not shown | Prevents direct social signals and report penalties from outweighing community evidence. |

There should be no `Social-known` badge in the direct-only model. If the only positive social evidence is a direct follow, the UI should say `You follow`. If there is no direct follow, direct mute, or report evidence, there is no social label.

## Report Policy

Reports are moderation evidence, not social gossip. BudaBit should use reports from current community authorities.

| Rule | Policy |
| --- | --- |
| Report authors | Current community admins and moderators. |
| Report reasons | Any reason counts. Do not restrict trust calculations to `spam`. |
| Person reports | Apply directly to the reported pubkey in that community. |
| Event reports | Apply to the event author when resolvable. |
| Event report scope | Section-scoped when the report is section-scoped. |
| Person ban scope | Community-wide within the reporting community. |
| Weight | A report penalty counts twice as much as a mute. |
| Global effect | No global distrust signal. Reports only matter in relevant community contexts. |

Community report evidence should be based on effective moderation state, meaning deleted reports are ignored and removed moderators do not continue to provide valid authority. This matches the existing community moderation model where bans and event censors are explicit, reversible, and auditable.

Side note: BudaBit may enable member-authored reporting on events as a moderation workflow. Those member reports do not affect web-of-trust calculations by themselves. They are review inputs for community moderators and admins. They only influence trust indirectly if a current moderator or admin makes an effective moderation decision, such as publishing an authorized event report or person ban based on those member reports.

## Community Ban Policy

Community bans should be visible and contextual.

| Context | Effect |
| --- | --- |
| Active community feed/catalog | Hide or suppress community-bound content by a person banned in that community. |
| Community-bound repo discovery | Do not load or present that person's repo as endorsed by the community where they are banned. |
| Canonical repo route | The repo can still be viewed outside the community context if otherwise resolvable. |
| Profile page | Show conspicuous context such as `Banned in this community` when relevant. |
| Other communities | Do not carry the ban as a global negative signal. |

Bans should not mutate profile-list grants or membership history. They are an override layer. When a ban is revoked, historical grants can become relevant again unless separately revoked.

## Repo Association Policy

Repositories need context. A repo associated with a community should be evaluated first through that community.

| Association evidence | Trust treatment |
| --- | --- |
| Association to active community exists | The active community becomes the primary repo trust context. |
| Association was made by a current admin or Repositories-section moderator | Strong association evidence. |
| Association was made by a user with current Repositories-section write grant | Valid association evidence. |
| Association was made by someone without current repo-scoped authority | Weak or ignored association evidence. |
| Associating user is banned in that community | Association should not endorse the repo in that community. |
| Repo owner is banned in that community | Do not show the repo as community-bound there. |

The important distinction is that a repo-community link is not equally meaningful from every author. If the association was made by someone who had a repo-scoped grant or authority to publish repository content in that community, that association should be trusted more than a random targeting event.

## Repo Discovery Policy

Repo discovery should put personally intentional signals first, then community context, then social hints.

| Order | Bucket | Rationale |
| --- | --- | --- |
| 1 | Viewer-owned repos | The user should always see their own work first. |
| 2 | Starred repos | Stars are explicit personal curation. |
| 3 | Active or selected community repos | The current community context is the app's primary collaboration surface. |
| 4 | Preferred/shared community repos | Community participation is stronger than social media context. |
| 5 | Community-associated owners/contributors | Useful when the repo is not directly in the active catalog. |
| 6 | Direct follows | Useful social discovery, but not collaboration trust. |
| 7 | Known repo owners | Fallback from already loaded repository events. |

Text relevance and recency can sort within each bucket. Internal trust scores can break ties, but the UI should describe the bucket and evidence rather than showing the score.

## PR And Collaboration Policy

PR metrics should distinguish community-aligned collaboration from social-only familiarity.

| Current concept | Replacement direction |
| --- | --- |
| Trusted author | `Community-aligned author` when community evidence exists. |
| Trusted maintainer merge | `Merged by community moderator/admin` or `Community-aligned merge`. |
| Trusted collaborators | `Community collaborators` or count-based phrasing. |
| Social-only trusted actor | Do not count as trusted. Use ordering only. |
| Raw trust score | Never display. |

Examples of acceptable UI phrases:

| UI phrase | Why it is acceptable |
| --- | --- |
| `2 community-aligned PRs` | Count-based and tied to a semantic category. |
| `Merged by community moderator` | Explains the role-based evidence. |
| `3 shared communities` | Count-based and understandable. |
| `You follow` | Concrete direct social reason. |
| `Banned here` | Conspicuous contextual moderation state. |

Examples to avoid:

| UI phrase | Problem |
| --- | --- |
| `Trust score: 7` | Opaque compound algorithm. |
| `Trusted` with only a direct follow | Overstates social context. |
| `Globally distrusted` | BudaBit does not create global distrust from community reports. |

## Context-Specific Decisions

| Surface | Trust behavior |
| --- | --- |
| Community feeds | Use community bans and event reports to suppress content in that community. |
| Community repo catalog | Prefer validated repo associations and suppress banned owners/associators. |
| Canonical repo page | Show community context if known, but do not hide the repo solely because of a community ban elsewhere. |
| PR list | Sort and badge by community evidence first. Direct follows can break ties. |
| Profile page | Show common communities, community roles, and relevant bans/reports as semantic evidence. |
| Settings | Describe BudaBit trust as community-based, not provider-based or social-rank-based. |

## Internal Scoring Constraints

BudaBit may still use internal scores to sort candidates, but they are implementation details.

| Constraint | Reason |
| --- | --- |
| Community membership floor is greater than maximum social cap | Social signals cannot outweigh community participation. |
| Moderator/admin evidence is stronger than member evidence | Role authority matters in communities. |
| Repo-associated community is weighted above unrelated communities | Trust should follow the repo's actual context. |
| Reports are negative and weigh twice a mute | Community moderation signal is stronger than personal social friction. |
| Bans can suppress only in their community context | Avoid global distrust from local moderation. |
| Raw scores are not displayed | Users need understandable evidence, not algorithmic numbers. |

## Reasoning Principles

1. BudaBit trust should be explainable by visible community facts.
2. Community grants and roles are stronger than social-media relationships.
3. Social data is useful but must be bounded and direct.
4. Moderation is contextual, reversible, and auditable.
5. A person can be banned in one community without being globally distrusted.
6. Repo trust should follow the community that intentionally associated with the repo.
7. UI should show semantic badges and count-based summaries, not opaque trust scores.
