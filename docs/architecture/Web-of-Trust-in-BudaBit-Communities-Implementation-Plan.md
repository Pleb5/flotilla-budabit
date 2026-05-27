# Web of Trust in BudaBit Communities Implementation Plan

## Goal

Replace the current social-first web-of-trust behavior with a client-side, community-first trust system for BudaBit. The system should use Communikey community roles, profile-list grants, repo-community associations, and contextual moderation state as primary evidence. Direct follows and mutes remain as capped personal discovery signals.

## Done Criteria

| Area | Done when |
| --- | --- |
| Social graph | No BudaBit trust surface depends on 2-hop follows-of-follows scoring. |
| Community graph | Trust evidence can be derived from kind `10222`, kind `30000`, and effective community reports. |
| Reports | Reports from current admins/moderators apply contextually, with report penalties twice mute penalties. |
| Bans | Community bans suppress community-bound content only in that community and are shown conspicuously. |
| Repo context | Repo-community associations are weighted by the associated community and validated by repo-scoped authority where possible. |
| Discovery | Repo discovery orders owned, starred, community, direct-follow, and fallback buckets in that order. |
| UI language | Raw scores disappear from user-facing surfaces; semantic badges and counts replace opaque trust labels. |
| NIP-85 | NIP-85 remains unused and gated. |

## Phase 1: Feature Gate And Baseline Cleanup

| Task | Details | Primary files |
| --- | --- | --- |
| Confirm feature gate behavior | Keep NIP-85 unused and gated. | `vite.config.ts`, `src/feature-flags.d.ts`, `.env.example`, feature docs |
| Stop loading inactive provider trust inputs | Ensure inactive provider data does not affect sync, repo metrics, or trust graph derivation. | `src/app/core/sync.ts`, `src/app/core/trust-graph.ts`, `src/app/core/repo-trust-metrics.ts` |
| Update Trust settings copy | Make Trust settings describe client-side BudaBit community trust. | `src/routes/settings/trust/+page.svelte`, related components |
| Preserve stored data safely | Leave old private settings inert rather than deleting user data. | Existing app-data storage code |

Validation:

| Test | Expected result |
| --- | --- |
| Build with default env | Provider-based trust UI and behavior are unavailable. |
| Existing user with stored provider config | App ignores it without errors. |
| Repo metrics load | Metrics use only client-side BudaBit trust inputs. |

## Phase 2: Trust Evidence Types

Introduce a small vocabulary that separates internal ordering from user-visible reasons.

| Type | Purpose |
| --- | --- |
| `TrustEvidence` | One concrete reason, such as `community_member`, `community_moderator`, `you_follow`, `muted_by_you`, `community_report`, or `community_ban`. |
| `TrustContext` | The context being evaluated: global discovery, active community, specific community, or repo. |
| `TrustAssessment` | Internal result containing score, category, evidence list, suppression state, and display labels. |
| `RepoCommunityContext` | Repo association evidence, associated community pubkey, association author, and validation state. |

Suggested assessment shape:

```ts
type TrustCategory =
  | "self"
  | "owned"
  | "starred"
  | "community_admin"
  | "community_moderator"
  | "community_member"
  | "community_associated"
  | "direct_follow"
  | "known"
  | "suppressed"
  | "unknown"

type TrustEvidence = {
  type: string
  communityPubkey?: string
  sectionName?: string
  repoAddress?: string
  count?: number
  label: string
}

type TrustAssessment = {
  category: TrustCategory
  score: number
  evidence: TrustEvidence[]
  suppressed: boolean
  suppressionReason?: "community_ban" | "event_report"
}
```

Rules:

| Rule | Reason |
| --- | --- |
| `score` remains internal | UI should not display opaque compound values. |
| `evidence` drives UI labels | Users need understandable explanations. |
| `suppressed` is separate from score | Community bans and event reports are rendering decisions, not just rank changes. |

## Phase 3: Replace 2-Hop Social WoT With Direct Social Overlay

| Task | Details | Primary files |
| --- | --- | --- |
| Remove `getWotGraph()` dependency from BudaBit trust | Stop using Welshman 2-hop scores for app-level trust decisions. | `src/app/core/trust-graph.ts` |
| Keep direct follows | Use `getFollows(viewerPubkey)` for `You follow`. | `src/app/core/trust-graph.ts` |
| Keep direct mutes | Use direct mute list for `Muted by you`. | `src/app/core/trust-graph.ts` |
| Apply overlay cap | Ensure direct follows, mutes, and report penalties cannot outrank basic community membership. | Trust score constants/helpers |
| Rename bucket labels | Replace vague social terms with concrete labels. | `src/app/util/repo-discovery-search.ts`, route UI |
| Retire old profile WoT circle | Remove the `WotScore` ring/gauge from profile and suggestion contexts because it exposes old opaque social WoT. | `src/app/components/WotScore.svelte`, `src/app/components/Profile.svelte`, `src/app/editor/ProfileSuggestion.svelte` |

Suggested constants:

| Constant | Example value | Constraint |
| --- | --- | --- |
| `DIRECT_FOLLOW_WEIGHT` | `1` | Small positive signal. |
| `DIRECT_MUTE_WEIGHT` | `-1` | Same magnitude as follow, negative. |
| `REPORT_WEIGHT` | `-2` | Twice a mute. |
| `OVERLAY_CAP` | `2` or `3` | Must be below member floor. |
| `COMMUNITY_MEMBER_FLOOR` | `4` | Must exceed max social cap. |

Validation:

| Scenario | Expected result |
| --- | --- |
| Target only directly followed | Appears in discovery/order as `You follow`, but does not count as community trusted. |
| Target only directly muted | Can be ranked lower, but is not hard-blocked. |
| Target directly followed and muted | Signals cancel or net within cap. |
| Large follow list | No loading of follows for each followed user. |
| Profile display or typeahead suggestion | No circular WoT gauge or raw social-score marker is rendered. |

## Phase 4: Community Trust Builder

Build a community-first assessment engine from loaded community definitions, profile lists, and report states.

| Task | Details | Primary files |
| --- | --- | --- |
| Collect community refs for viewer and candidates | Reuse and generalize `selectUserCommunityRefs`. | `src/app/core/community-membership.ts`, new trust helper |
| Score shared communities | Strongly weight communities shared by viewer and candidate. | New community trust helper |
| Score roles | Admin > moderator > member/grantee. | New community trust helper |
| Score shared sections | Add context when viewer and candidate share writable sections. | New community trust helper |
| Cap repeated overlap | Use diminishing returns for many communities. | New community trust helper |
| Produce semantic evidence | Emit labels such as `Shared community`, `Moderator`, and `Can participate`. | New trust helper and UI adapters |

Community role weighting policy:

| Role evidence | Relative priority |
| --- | --- |
| Admin of relevant community | Highest community role. |
| Moderator of relevant section | Strong role. |
| Member/grantee in relevant section | Basic community trust floor. |
| Shared writable section | Additive context. |
| Unrelated community membership | Lower than repo-associated or active-community evidence. |

Validation:

| Scenario | Expected result |
| --- | --- |
| Target is member in active community | Outranks direct follows. |
| Target is moderator in active community | Outranks regular members. |
| Target shares multiple communities | Evidence shows counts, internal score grows with cap/diminishing return. |
| Target is only a social follow | Not counted as community-aligned. |

## Phase 5: Reports And Ban Integration

Reports need to become trust evidence while preserving community moderation semantics.

| Task | Details | Primary files |
| --- | --- | --- |
| Accept any report reason | Trust policy should not only parse `spam` as meaningful. | `src/app/core/community-reports.ts` |
| Identify authority reporters | Only current admins/moderators count for community trust penalties. | `src/app/core/community-reports.ts`, `community-permissions.ts` |
| Resolve event-report authors | Event reports degrade the event author when author is available from tags or loaded event. | `community-reports.ts`, event loaders/helpers |
| Apply report weight | Report penalty is twice a mute in the relevant context. | Trust helper |
| Keep bans contextual | Suppress only in the banned community context. | Community feeds/catalogs/trust helper |
| Emit conspicuous evidence | UI can show `Banned here`, `Reported here`, or report counts. | UI adapters |

Report handling table:

| Input | Trust effect |
| --- | --- |
| Effective person report by current admin/moderator | Negative evidence for target in that community. |
| Effective event report by current admin/moderator | Negative evidence for event author in that section/community. |
| Deleted report | No trust effect. |
| Report by removed moderator | No trust effect after authority is removed. |
| Report in unrelated community | No effect outside that community context. |

Validation:

| Scenario | Expected result |
| --- | --- |
| Person banned in active community | Community-bound content suppressed and UI indicates ban. |
| Person banned in unrelated community | No global suppression. |
| Event report with resolvable author | Author receives contextual negative evidence. |
| Report deleted | Penalty disappears. |

## Phase 6: Repo Community Context

Repo trust should be scoped around the community that intentionally associated with the repo.

| Task | Details | Primary files |
| --- | --- | --- |
| Load repo association events | Use targeted publication/community association events for repo announcements. | `src/app/core/community-targeting.ts`, repo/community routes |
| Build `RepoCommunityContext` | Include associated community, association author, relay hints, and validation state. | New repo trust helper |
| Validate association authority | Strongly trust association if author is admin, Repositories-section moderator, or has repo-section grant. | `community-permissions.ts`, new helper |
| Weight associated community first | Repo PR metrics and discovery use this community above unrelated communities. | `repo-trust-metrics.ts`, discovery helpers |
| Suppress invalid community-bound repos | If owner or associator is banned in that community, do not show as community-bound. | Community repo catalog routes |

Association validation table:

| Association author state | Treatment |
| --- | --- |
| Community admin | Strong valid association. |
| Repositories-section moderator | Strong valid association. |
| Repositories-section member/grantee | Valid association. |
| Current banned person in that community | Invalid for community endorsement. |
| No repo-section authority | Weak or ignored. |

Validation:

| Scenario | Expected result |
| --- | --- |
| Repo associated by repo moderator | Repo is strongly community-associated. |
| Repo associated by repo-section grantee | Repo is community-associated. |
| Repo associated by outsider | Does not receive strong community endorsement. |
| Repo owner banned in community | Repo omitted from that community catalog. |

## Phase 7: Repo Discovery Integration

Update discovery buckets and labels to match the new policy.

| Order | Bucket | Inputs |
| --- | --- | --- |
| 1 | Owned by you | Viewer pubkey. |
| 2 | Starred | Active repo stars. |
| 3 | Active community repos | Selected or active community association. |
| 4 | Shared/preferred community repos | Active user community refs and preferred communities. |
| 5 | Community-associated owners | Repo owners connected through community evidence. |
| 6 | You follow | Direct follows only. |
| 7 | Known repo owners | Already loaded repo owners. |

Implementation tasks:

| Task | Primary files |
| --- | --- |
| Rename and reorder priority keys | `src/app/util/repo-discovery-search.ts` |
| Feed community trust assessments into discovery | `src/routes/git/+page.svelte`, trust helper |
| Add suppression for active-community bans | Community repo query/filter code |
| Update tests for bucket order | `repo-discovery-search.test.ts` |

Validation:

| Scenario | Expected result |
| --- | --- |
| Search matches viewer-owned and community repo | Viewer-owned appears first. |
| Search matches starred and active community repo | Starred appears before community bucket. |
| Search matches direct follow and community member | Community member appears before follow. |
| Community-banned repo owner | Not shown as community-bound in that community. |

## Phase 8: Repo Metrics And PR Lists

Replace broad `trusted` semantics with community-aligned categories.

| Current label | New direction |
| --- | --- |
| Trusted merged contributions | Community-aligned merged contributions. |
| Trusted maintainer merges | Merged by community admin/moderator or community-aligned maintainer. |
| Trusted collaborators | Community collaborators. |
| Trusted author badge | Community-aligned author, Community member, You follow. |
| Trusted maintainer badge | Community moderator/admin, Community-aligned merge. |

Implementation tasks:

| Task | Primary files |
| --- | --- |
| Change metric categories | `src/app/core/repo-trust-metrics.ts` |
| Preserve internal sorting score | New trust assessment helper |
| Use evidence badges in PR list | `src/routes/git/[id=naddr]/prs/+page.svelte` |
| Update repo overview cards | `src/routes/git/[id=naddr]/+page.svelte` |
| Update profile code trust analysis terms | `src/app/core/profile-collab-analysis.ts`, profile route |

Validation:

| Scenario | Expected result |
| --- | --- |
| PR author only directly followed | Can sort higher but does not increment community-aligned PR count. |
| PR author in repo-associated community | Counts as community-aligned. |
| Merge applied by community moderator | Counts as community-aligned merge. |
| Actor banned in associated community | Suppressed/degraded in that repo-community context. |

## Phase 9: UI Evidence And Copy

Convert the UI from raw trust language to semantic evidence.

| Surface | UI changes |
| --- | --- |
| Repo discovery | Bucket labels explain why a repo appears. |
| Repo overview | Cards use count-based community wording. |
| PR list | Badges show concrete evidence, not raw trust. |
| Profile page | Shows shared communities, roles, relevant bans, and direct follow/mute evidence. |
| Settings | Describes BudaBit trust as community-first and client-side. |

Avatar/profile indicator policy:

| Previous behavior | New behavior |
| --- | --- |
| Tiny WoT circle/gauge near profile names | Removed. |
| Avatar halo or ring implying compound trust | Avoided. |
| Raw profile-level trust marker | Avoided. |
| Contextual semantic chip | Allowed when there is concrete evidence, such as `You follow`, `Moderator`, `Community member`, `Banned here`, or `Reported here`. |

The old profile WoT circle is specifically undesirable because it is visually cryptic, based on social-score derivation, and looks like a global identity reputation marker. BudaBit should not put compound trust halos around identities. Trust labels should appear only where the current context can explain them.

Preferred labels:

| Label | Use when |
| --- | --- |
| `Owned by you` | Viewer owns repo. |
| `Starred` | Viewer starred repo. |
| `Community repo` | Repo has valid community association. |
| `Associated by repo grant` | Association author had Repositories-section grant. |
| `Shared community` | Viewer and actor share community membership/role. |
| `Community member` | Actor is listed in a referenced profile list. |
| `Moderator` | Actor owns a referenced profile list. |
| `Admin` | Actor is community pubkey. |
| `You follow` | Direct follow. |
| `Muted by you` | Direct mute. |
| `Reported here` | Effective report in current context. |
| `Banned here` | Effective person ban in current context. |

Avoided labels:

| Label | Reason |
| --- | --- |
| `Social-known` | Redundant without 2-hop social graph. |
| `Trust score` | Opaque and not user-meaningful. |
| `Globally distrusted` | Contradicts contextual ban policy. |
| `Trusted` by itself | Too vague without semantic evidence. |

## Phase 10: Tests And Regression Coverage

| Test area | Required cases |
| --- | --- |
| Bounded overlay | Follow, mute, report penalty, follow plus mute, cap behavior. |
| Community roles | Admin, moderator, member, shared section, multiple communities. |
| Reports | Any reason, person report, event report, deleted report, removed moderator. |
| Bans | Active community suppression, unrelated community non-effect, revoked ban. |
| Repo association | Admin association, moderator association, grantee association, outsider association, banned associator. |
| Discovery | Owned > starred > community > follow > known owner. |
| Repo metrics | Social-only actors do not increment community-aligned counts. |
| UI labels | No raw score display and no vague social-known label. |

## Rollout Strategy

| Step | Reason |
| --- | --- |
| Keep old tests while adding new trust evidence tests | Prevent accidental regressions during refactor. |
| Introduce new helpers before switching call sites | Allows parallel validation against current behavior. |
| Migrate repo discovery first | Lowest risk and most visible policy win. |
| Migrate repo metrics and PR badges next | Requires clearer category changes. |
| Migrate profile analysis last | Profile page combines community and repo evidence and benefits from stabilized helpers. |
| Remove stale labels after call sites are migrated | Avoid mixed `trusted` and `community-aligned` language. |

## Open Implementation Details

| Detail | Proposed default |
| --- | --- |
| Exact role weights | Pick constants only after tests encode ordering invariants. |
| Multiple shared community scaling | Use capped or diminishing additive score. |
| Event report author resolution | Prefer report `p` tag, fall back to loaded target event author. |
| Association without authority | Keep discoverable if canonical, but do not mark as community-endorsed. |
| Stored old trust rules | Keep inert while gated; do not delete user data. |
