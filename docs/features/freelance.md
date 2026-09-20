# Community Freelance

Budabit's default community definition includes a **Freelance** content section for SatShoot-compatible jobs, services, proposals, orders, and reviews. New-community drafts and **Restore defaults** both use it. The interactive workspace is provided by a community-targeted Smart Widget.

## Default event types

| Kind    | Purpose                                |
| ------- | -------------------------------------- |
| `32765` | Service listings                       |
| `32766` | Service orders                         |
| `32767` | Job listings                           |
| `32768` | Job proposals/bids                     |
| `1986`  | Qualitative Thumb System (QTS) reviews |

All five descriptors have an empty subtype and belong to **Freelance** by default. Owners may rename the section or reorganize its types; each exact `(kind, subtype)` pair must belong to only one section. Widget capability checks resolve descriptors against the selected definition rather than relying on the section's name.

The source of truth is `DEFAULT_COMMUNITY_SECTION_NAMES` and `getDefaultCommunitySectionKinds` in `src/app/core/community.ts`. The editor also offers named options for all five types.

## Enable it in a community

1. **New community:** the creation draft already includes Freelance. Configure its publishing access along with the other sections before publishing the definition.
2. **Existing community:** as the owner, open the community editor and choose **Add Freelance** if the section is absent. This adds only that preset and preserves the other sections. If any of its types are already assigned elsewhere, edit those assignments instead of creating duplicates. Configure the section's `kind:30000` profile-list grants, then publish the updated definition.
3. A **Widget-curator** writer publishes or selects a Freelance Smart Widget manifest (`kind:30033`) and targets it to the exact community using a `kind:30222` targeting event. The Freelance section grants workflow access; Widget-curator grants widget-curation access.
4. Enable the widget in Budabit and approve its declared permissions. Community Freelance v0.4.0 uses the `community-home-quicklinks` slot: a compact **Freelance** button with the SatShoot icon sits alongside the home quicklinks. Clicking it loads **Jobs**, **Services**, and **My work** in a wide, responsive dialog; closing the dialog removes its iframe. Existing installations can refresh their manifest through **Settings → Extensions → Update widget**. Deploy the host's quicklink-slot support alongside this widget version.

Updating the app does not rewrite already published community definitions. **Restore defaults** rebuilds the full section layout and can replace custom sections; use **Add Freelance** when you only want to add this section. Default section configuration does not bundle or install widget code by itself.

## Workflows

- **Jobs:** a client publishes a job; a freelancer sends a proposal; the client accepts, then records completion or failure. The counterparties can review the concluded engagement.
- **Services:** a freelancer publishes a service; a client places an order; the freelancer accepts; the client records fulfillment or failure. The counterparties can then review the engagement.
- **Thumbnails:** the widget supports upload, preview, replacement and removal. Upload destinations are the exact definition's Blossom servers first, followed by personal and widget-build defaults. The existing bridge does not expose Budabit's personal/default Blossom settings; the widget uses a personal URL field or a signed kind-10063 list found on community relays, plus its own deployment default.
- **Payments and private messages:** the current widget does not implement them. Recording a work outcome does not assert that a payment occurred.

## Scope and host integration

### Publishing access requests

The widget's per-action publish gate offers **Access options** when the signing account lacks a scoped grant. It uses the existing `ui:navigate` action to open `/c/<exact-definition-naddr>/access?section=<section-hint>&kind=<action-kind>`. Membership resolves the kind against the current exact definition; the hint can be stale after a section is renamed or reorganized.

This action link focuses the matching section's current authorized application form or existing pending/rejected/granted request state. A section without a form shows its no-form message. An unsupported or invalid descriptor shows setup guidance rather than another section's application. **View all publishing requests** restores the complete list. Existing section-only links continue to scroll the full Membership list; optional `subtype` accompanies `kind` for descriptors that use one.

The widget saves open drafts before navigation. Application selection and submission status come from Membership's existing community-scoped state. The widget and updated Membership route must both be deployed to enable this focused behavior.

### Account profile and access recovery

Widget v0.5.1 adds `ui:openProfile`: clicking an account name/avatar opens Budabit's existing profile modal. Dismissing it returns to the still-mounted Freelance widget. Its View full profile link opens a separate tab, preserving the widget and draft. Open Chat retains normal same-tab navigation. This requires the corresponding host bridge action and updated widget manifest permission.

Widget v0.5.0 uses the read-only [`profiles:resolve`](../extensions/profiles.md) bridge API for all account displays, including listing cards/details, proposals/orders, participants, and reviews. The host adapter reads the existing shared profile store and invokes the existing resolver with current community relay hints. Configured indexers and known-author outbox fallback follow normal Budabit profile policy. Cached profiles appear immediately; missing names fall back to npubs after lookup, and late profiles/edits update the same labels. Account/community changes and iframe closure release the watch. Deploy this host API and install the new widget manifest permission to enable it; older hosts retain npub fallback.

Widget v0.4.1 consumes Budabit's existing `widget:init.user` name/avatar only when its pubkey matches the current community viewer. `WidgetFrame` resends this metadata after profile hydration or account changes. The widget's profile-only updates preserve its relay connections.

Launcher dialogs own a live community runtime-store subscription, independent of the launcher's lifetime. The public `communityContext` and capability requests share the same versioned snapshot. Ready descriptors carry `authorityEvidenceSettled`; missing referenced lists can then produce ordinary missing-grant results instead of permanent context-unavailable errors. During pending authority, the dialog retains public context for drafts while bridge requests fail closed. The store remains pinned to the exact community address.

**Check again** and activity refresh repeat the existing `widget:ready` / `widget:init` handshake before permission checks. The host answers repeated readiness from the correct iframe without repeating `widget:mounted`. Stale permission replies remain rejected. Empty Jobs/Services views provide creation controls when granted and access/sign-in/retry guidance otherwise.

Widget v0.4.1 was published on 2026-09-20 to `wss://relay.budabit.club`, manifest `5ab0798c63d80e096a6f14abc29780c8603a74b66ac682c20b63e9e71c5f3718`. It requires host commit `f22037a9f` (or a descendant), already available on localhost. **Settings → Extensions → Update widget** was verified at localhost against the live relay, changing a v0.4.0 installed snapshot to v0.4.1 and its new Blossom HTML URL. Existing installations need that local update, followed by closing/reopening Freelance. Production needs the same host fixes; production deployment was not performed in this release step.

Implementation verification used the real dev host and production widget HTML with MockRelay/assets and generated view-only accounts: 35 widget tests, 124 focused host tests, zero host/widget Svelte diagnostics, and two desktop/mobile browser flows. These cover late profiles, missing lists, grant/revocation, stale-context recovery, retained drafts, account/guest changes, access routing, and the prior quicklink/focus behavior. Repo-wide E2E type checking still reports unrelated test errors outside the changed files.

### Relay and bridge scope

The Community Freelance widget receives Budabit's exact community context, resolves its kind-32222 definition, checks descriptor write capabilities, and uses `nostr:sign`. It owns its relay connection pool and sends freelance reads and writes only to that definition's `r` relays. Its freelance records carry `h=<communityId>` and a marked exact-definition `a` tag; SatShoot workflow references are separate. The widget manifest is targeted through kind 30222, while the freelance records themselves are directly community-bound.

Signing kinds include the five workflow kinds, author deletion **5**, relay authentication **22242**, and Blossom HTTP authorization **24242**. The latter is sent to the upload server, not published as relay content. These signing declarations are separate from the section's five content kinds.

The widget implements scope and lifecycle checks; it does not use `community:queryEvents` or the host's generic `nostr:publish`. Host checks and automatic content moderation do not cover arbitrary widget-owned network traffic. See [the extension guide](../extensions/README.md) for the existing bridge and targeting model.

The section remains ordinary Communikeys configuration: its grants use the current exact definition and referenced profile lists, and declaring a kind does not supply its renderer. See the [community architecture](../architecture/Budabit-Community-Architecture.md) for definition and permission semantics.
