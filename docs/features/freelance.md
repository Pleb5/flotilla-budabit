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
4. Enable the widget in Budabit and approve its declared permissions. The Community Freelance widget uses the `community-home-after-quicklinks` slot and expands inline into **Jobs**, **Services**, and **My work**.

Updating the app does not rewrite already published community definitions. **Restore defaults** rebuilds the full section layout and can replace custom sections; use **Add Freelance** when you only want to add this section. Default section configuration does not bundle or install widget code by itself.

## Workflows

- **Jobs:** a client publishes a job; a freelancer sends a proposal; the client accepts, then records completion or failure. The counterparties can review the concluded engagement.
- **Services:** a freelancer publishes a service; a client places an order; the freelancer accepts; the client records fulfillment or failure. The counterparties can then review the engagement.
- **Thumbnails:** the widget supports upload, preview, replacement and removal. Upload destinations are the exact definition's Blossom servers first, followed by personal and widget-build defaults. The existing bridge does not expose Budabit's personal/default Blossom settings; the widget uses a personal URL field or a signed kind-10063 list found on community relays, plus its own deployment default.
- **Payments and private messages:** the current widget does not implement them. Recording a work outcome does not assert that a payment occurred.

## Scope and host integration

The Community Freelance widget receives Budabit's exact community context, resolves its kind-32222 definition, checks descriptor write capabilities, and uses `nostr:sign`. It owns its relay connection pool and sends freelance reads and writes only to that definition's `r` relays. Its freelance records carry `h=<communityId>` and a marked exact-definition `a` tag; SatShoot workflow references are separate. The widget manifest is targeted through kind 30222, while the freelance records themselves are directly community-bound.

Signing kinds include the five workflow kinds, author deletion **5**, relay authentication **22242**, and Blossom HTTP authorization **24242**. The latter is sent to the upload server, not published as relay content. These signing declarations are separate from the section's five content kinds.

The widget implements scope and lifecycle checks; it does not use `community:queryEvents` or the host's generic `nostr:publish`. Host checks and automatic content moderation do not cover arbitrary widget-owned network traffic. See [the extension guide](../extensions/README.md) for the existing bridge and targeting model.

The section remains ordinary Communikeys configuration: its grants use the current exact definition and referenced profile lists, and declaring a kind does not supply its renderer. See the [community architecture](../architecture/Budabit-Community-Architecture.md) for definition and permission semantics.
