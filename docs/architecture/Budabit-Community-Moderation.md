# Budabit Community Moderation

This document describes how moderation, admission, and section access should work in Budabit communities.

The goal is to let communities stay readable and discoverable while keeping publication rights high-signal, fine-grained, and delegated to moderators instead of requiring the community root key for day-to-day work.

## Summary

Budabit communities use `kind:10222` Communikey definitions for stable community structure. Section write access is enforced by `kind:30000` profile lists and explained by `kind:30009` badges. Admission requests use NIP-101 forms created by moderators, not by the community root key.

Moderators create application forms as `kind:30168` events. A form references the community definition with an `a` tag and identifies the requested section with a `content` tag. Users submit public, identified `kind:1069` responses to request access. Moderators review responses and either grant access by updating the section profile list and awarding the badge, or reject by reacting negatively to the response.

## Core Decisions

| Topic | Decision |
|---|---|
| Community root stability | `kind:10222` should change rarely and must not list application forms. |
| Form ownership | Application forms are authored by moderators with grant capability for the section. |
| Form discovery | Forms are discovered from community relays by community `a` tag and section `content` tag. |
| Read access | Users may read community content where relays serve it, but Budabit filters permission-governed content by authorized authors. |
| Write access | Effective publish permission comes from section profile-list membership. |
| Admission request | Users submit an identified public `kind:1069` response to the selected application form. |
| Duplicate applications | Budabit allows one active submission per user/form. Resubmission requires a `kind:5` delete of the old response. |
| Grant | Publish a badge award, update the section profile list, and publish a `+` reaction on the response. |
| Reject | Publish a `-` reaction on the response. No badge award and no profile-list edit. |
| Root visibility | Root-level section content only appears when explicitly allowed by current section permissions and targeting rules. Replies do not make roots visible. |
| Censoring | Explicit moderation uses NIP-56 `kind:1984` reports with report type `spam`; it is a negative overlay on top of normal visibility and write permissions. |
| Relays | Forms, responses, reactions, badge awards, and profile-list edits are confined to the community relays plus any explicit authority relay hints. |
| Anonymous submissions | Not supported. Admission requests must be tied to the requesting pubkey. |

## Why Forms Are Not In `kind:10222`

Application forms are operational moderation state. They may change frequently as moderators improve questions, requirements, onboarding language, and anti-spam checks.

`kind:10222` is community root configuration. It should be stable, rare to update, and usually signed by a cold or high-trust community key. Requiring the community root key to update application forms would make admission workflows too rigid and would prevent delegated moderators from curating section-specific applications.

Instead, forms self-associate with the community and section:

```json
{
  "kind": 30168,
  "pubkey": "<moderator-pubkey>",
  "tags": [
    ["d", "repo-curator-application"],
    ["a", "10222:<community-pubkey>:", "wss://community.example"],
    ["content", "Repositories"],
    ["name", "Repository curator application"],
    ["settings", "{\"description\":\"Tell us why you should curate repositories.\"}"],
    ["field", "experience", "text", "What relevant experience do you have?", "", "{\"required\":true}"],
    ["field", "focus", "text", "What kinds of repositories will you add?", "", "{\"required\":true}"]
  ],
  "content": ""
}
```

The empty identifier in `10222:<community-pubkey>:` is intentional. Budabit treats the community definition as a replaceable community root event rather than a section-specific addressable object.

## Moderator Authority

A moderator can create and review forms for a section only when the moderator can grant that section's access.

Grant capability requires both:

| Capability | Source |
|---|---|
| Profile-list management | The moderator pubkey is the author of the section's `kind:30000` profile-list reference. |
| Badge issuing | The moderator pubkey is the author of the section's `kind:30009` badge definition reference. |

This keeps the first implementation simple and prevents users from applying through forms whose authors cannot approve them.

If a future community wants separate reviewers who cannot grant access, Budabit can add a reviewer role later. That should be explicit rather than inferred from form authorship.

## Section Forms

Form discovery starts from the active community definition.

For a requested section:

1. Find the section in latest `kind:10222`.
2. Derive grant-capable moderator pubkeys from the section profile-list and badge references.
3. Query community relays for `kind:30168` authored by those moderators and tagged to the community definition.
4. Client-side filter to forms with `content = <section name>`.
5. Resolve the active form by addressable event semantics and deterministic ordering.

Example form query:

```json
{
  "kinds": [30168],
  "authors": ["<moderator-pubkey-1>", "<moderator-pubkey-2>"],
  "#a": ["10222:<community-pubkey>:"]
}
```

Budabit should filter `content` tags client-side because section names are application semantics and relay support for arbitrary tag filters may vary.

When multiple eligible forms are found for the same section, Budabit should select one active form with this ordering:

| Step | Rule |
|---|---|
| 1 | Collapse replaceable/addressable form updates by `30168:<author>:<d>`. |
| 2 | Keep the newest event per form address. |
| 3 | Across eligible form addresses, choose highest `created_at`. |
| 4 | If timestamps tie, choose the lowest event id. |

This lets moderators supersede forms without touching `kind:10222`.

## Application Responses

Applications are public NIP-101 responses authored by the applicant.

```json
{
  "kind": 1069,
  "pubkey": "<applicant-pubkey>",
  "tags": [
    ["a", "30168:<form-pubkey>:repo-curator-application"],
    ["response", "experience", "I maintain several Nostr repositories.", "{}"],
    ["response", "focus", "Developer tooling and protocol libraries.", "{}"]
  ],
  "content": ""
}
```

Budabit should not support anonymous admission applications because the request must map to the pubkey being granted access.

Only community relays should be used for application publication and review state. A user may read public community content without membership, but admission state belongs to the community's relay set.

## Submission Lifecycle

Budabit allows one active submission per user and application form.

| State | Meaning | User action |
|---|---|---|
| None | No non-deleted response exists. | Fill and submit the form. |
| Pending | A response exists and has no authorized `+` or `-` review reaction. | View submission or delete to resubmit. |
| Granted | An authorized `+` reaction exists or the user is in the section profile list. | Access is available. |
| Rejected | An authorized `-` reaction exists and no newer authorized grant exists. | Delete the submission to submit a revised application. |
| Deleted | A valid `kind:5` by the applicant deletes the response. | The previous answers may be locally preserved for editing before resubmission. |

If a relay accepts multiple active submissions from outside Budabit, Budabit should surface the latest non-deleted response by timestamp and then lowest id. The UI may warn that multiple active submissions exist, but normal application logic should use the selected current response.

Delete event example:

```json
{
  "kind": 5,
  "pubkey": "<applicant-pubkey>",
  "tags": [
    ["e", "<form-response-event-id>"],
    ["k", "1069"]
  ],
  "content": "Deleted application submission"
}
```

A delete only counts when it is authored by the same pubkey as the response being deleted.

## Review Events

Granting access publishes three events:

```json
[
  {
    "kind": 30000,
    "pubkey": "<profile-list-manager-pubkey>",
    "tags": [
      ["d", "Repositories"],
      ["p", "<existing-writer-pubkey>"],
      ["p", "<applicant-pubkey>"]
    ],
    "content": ""
  },
  {
    "kind": 8,
    "pubkey": "<badge-issuer-pubkey>",
    "tags": [
      ["a", "30009:<badge-issuer-pubkey>:Repositories"],
      ["p", "<applicant-pubkey>"]
    ],
    "content": ""
  },
  {
    "kind": 7,
    "pubkey": "<moderator-pubkey>",
    "tags": [
      ["e", "<form-response-event-id>"],
      ["p", "<applicant-pubkey>"],
      ["k", "1069"]
    ],
    "content": "+"
  }
]
```

Rejecting access publishes only a negative reaction:

```json
{
  "kind": 7,
  "pubkey": "<moderator-pubkey>",
  "tags": [
    ["e", "<form-response-event-id>"],
    ["p", "<applicant-pubkey>"],
    ["k", "1069"]
  ],
  "content": "-"
}
```

Only reactions authored by grant-capable moderators for the requested section should count as review decisions.

The `+` reaction is intentionally redundant with the profile-list edit. It creates a review audit marker, makes moderation queues easy to group, and preserves evidence of grants even if a profile list is accidentally overwritten.

## Effective Permissions

Budabit should present access in human section terms, but enforce it by publish effect.

A section defines the event kinds and optional Budabit subtypes it authorizes. From this, Budabit derives a capability map for the logged-in user.

Example:

| Section | Section grants | User result |
|---|---|---|
| General | `kind:9` room messages, `kind:1111` comments, `kind:7` reactions, `kind:1985` labels | User may chat, comment, react, and label where those actions are valid. |
| Repositories | `kind:30617` repo announcements | User may publish repos targeted to the community. |

A user with General access but not Repositories access may react to a repository event but may not publish a new repository announcement for the community.

This avoids coupling UI features directly to section names. UI components should declare what they publish, and the permission layer maps that publish effect to the relevant section and application flow.

## Permission-Gated UX

Budabit should not hide inaccessible capabilities. It should show them as available community affordances that require access.

Every publishing component should be wrapped by a generic publish gate that receives the event kind, subtype if any, and a user-facing action label.

| Gate state | UI behavior |
|---|---|
| Allowed | Render the normal action. |
| Logged out | Render the action as muted and ask the user to log in before applying or publishing. |
| Missing permission | Render the action as muted, explain the required section permission, and link to Access Requests. |
| Pending | Show that an application is pending and link to the submission. |
| Rejected | Show rejected state and link to delete/resubmit flow. |
| Recently granted | Render normally and optionally highlight that access was granted. |

Examples:

| UI element | Missing-access behavior |
|---|---|
| Chat composer | Replace input with a compact request-access component for room-message permission. |
| Publish repo button | Keep visible but disabled with tooltip and link to repository access request. |
| Reaction button | Keep visible; if reaction permission is missing, open the Access Requests page instead of publishing. |
| Create room button | Keep visible in muted state and explain that Rooms permission is required. |

The user should always understand what permission is missing and where to request it.

## Read Visibility Policy

Budabit separates positive visibility from negative moderation.

Positive visibility answers whether content is community-approved by default. Negative moderation answers whether otherwise visible content should be hidden because an authorized moderator or admin explicitly censored it.

### Root-Level Events

Root-level events MUST only appear when they are explicitly allowed by the current community state.

Examples of root-level events include:

| Feature | Root event |
|---|---|
| Rooms | Room root `kind:11`/thread event with the Budabit room marker. |
| Forum | Thread root `kind:11` without the room marker. |
| Calendar | `kind:31922` event explicitly targeted to the community. |
| Goals | `kind:9041` event explicitly targeted to the community. |
| Repositories | `kind:30617` event explicitly targeted to the community. |
| Permalinks | `kind:1623` event explicitly targeted to the community. |
| Widgets | `kind:30033` event explicitly targeted to the community. |

Rules:

- A root event is visible only if it passes the section's current author allow-list and targeting rules.
- A valid reply, chat message, quote, mention, or other reference MUST NOT make an otherwise disallowed root event appear as a community root.
- If a root author's section access is revoked, their root events disappear from default section views and direct community detail pages unless separately allowed again later.
- Budabit does not currently implement historical “was allowed when posted” visibility. Current community state is the source of truth.

### Reply-Like Events

Reply-like events are visible when their conversation root is visible and the reply-like event itself passes the relevant section permission rules.

Examples:

| Feature | Reply-like event |
|---|---|
| Rooms | Room message `kind:9`. |
| Forum and targetable event discussions | Comment `kind:1111`. |
| Reactions and labels | `kind:7` and `kind:1985` where the current feature renders them. |

Rules:

- A permitted reply-like event may quote, mention, or reference any other event without additional warning labels.
- References do not grant root visibility to the referenced event.
- Explicit censoring still applies. If the referenced event or referenced event author is censored for the current context, render a moderation placeholder instead of the content.

This keeps normal conversations readable while avoiding root-level content smuggling.

## NIP-56 Censor Overlay

Budabit uses NIP-56 `kind:1984` reports as explicit moderation events. For community censoring, Budabit uses report type `spam` because it maps to unwanted content in a community context without inventing a new report type.

The censor overlay has precedence over default read visibility and write permission. It only hides content that would otherwise be considered for rendering.

### Report Shapes

Event censoring:

```json
{
  "kind": 1984,
  "pubkey": "<moderator-or-admin-pubkey>",
  "tags": [
    ["e", "<event-id>", "spam"],
    ["p", "<event-author-pubkey>"],
    ["a", "10222:<community-pubkey>:"],
    ["content", "<section-name>"]
  ],
  "content": "Optional moderation note"
}
```

Person censoring:

```json
{
  "kind": 1984,
  "pubkey": "<admin-or-all-section-moderator-pubkey>",
  "tags": [
    ["p", "<reported-pubkey>", "spam"],
    ["a", "10222:<community-pubkey>:"]
  ],
  "content": "Optional moderation note"
}
```

Rules:

- Event moderation is section-scoped and may be performed by an admin or a current moderator with grant capability for that section.
- Person moderation is community-scoped and may be performed by an admin or a current moderator who has grant capability for every section in the latest community definition.
- Admin means the current community root pubkey.
- Moderators cannot moderate another current moderator.
- Admin reports supersede moderator protection.
- Reports by removed moderators stop counting at render time.
- A report can be deleted with `kind:5`; deleted reports MUST be ignored.
- Censoring displays a placeholder such as `Moderated event` or `Moderated person` instead of silently dropping the item in contexts where a placeholder preserves conversation shape.

The render-time authority check is mandatory. Budabit must not trust that reports were only published through the web app.

### Censoring And Quotes

Quote and reference rendering is community-aware through the negative path:

- If a quoted event is not censored and can be fetched, it may render normally inside a permitted reply-like event.
- If a quoted event is censored by event id in the current section context, render `Moderated event`.
- If a quoted event author is censored community-wide, render `Moderated person`.
- If the quoted event cannot be fetched, render the existing unloaded quote state.

This avoids overcomplicating positive reference permissions while still preventing explicitly unwanted content from being smuggled through quotes.

### Censoring Scope

| Censor type | Scope | Who can publish an effective report |
|---|---|---|
| Event | Section | Admin or grant-capable moderator for that section. |
| Person | Community | Admin or moderator with grant capability for all sections. |

Section-scoped person moderation is intentionally not supported. Person moderation is stronger than hiding one event and should require community-wide authority.

## Access Requests Page

Budabit should provide one community-level access page for normal users.

Suggested route:

```text
/c/<community>/access
```

The page should show:

| Area | Contents |
|---|---|
| Granted | Sections and publish effects the user can currently use. |
| Pending | Active submissions waiting for moderator review. |
| Rejected | Rejected submissions with delete/resubmit actions. |
| Available | Sections with application forms that the user can request. |

Existing submissions are not editable. To change an application, the user must explicitly delete it, confirm the delete in a modal, and then submit a new response. Budabit may preserve the deleted response values locally to make editing easy.

## Moderator Panel

The moderator panel should be separate from the admin or owner panel. Owner/admin tools manage community root setup. Moderator tools manage forms, applications, grants, and rejections for sections the logged-in moderator can grant.

The moderation queue should be grouped by review state:

| Group | Sort |
|---|---|
| New | Newest pending submissions first. |
| Granted | Newest granted submissions first. |
| Rejected | Newest rejected submissions first. |

Each application card should show:

| Field | Purpose |
|---|---|
| Applicant profile | Make the applicant recognizable. |
| Requested section | Show what permission is being requested. |
| Form name | Show which admission form was answered. |
| Submitted time | Help moderators process recent requests. |
| Short response summary | Let moderators scan quickly. |
| Review action | Open or expand full response details. |

The review view should show the full response and buttons to grant or reject. Grant should publish the profile-list edit, badge award, and `+` reaction. Reject should publish the `-` reaction.

## Fetching Permissioned Views

For content subject to section permissions, Budabit should load the relevant profile list before requesting the section content.

Query construction should use allow-listed authors:

```json
{
  "kinds": [30617],
  "authors": ["<allowed-author-1>", "<allowed-author-2>"]
}
```

For targeted publications, Budabit should still discover targeting events for the community, but original content should only be accepted if its author is authorized for the section mapped to that publication kind.

If the relevant profile list cannot be loaded, Budabit should not broaden the query to all authors for permission-governed views. Failing closed prevents relay leakage from being treated as community-approved content.

## Rationale

This model accepts some application workflow overhead because it gives communities a competitive moderation surface.

Communities can set different requirements for different publishing capabilities. They can keep general participation easy while making higher-impact publication types more curated. Moderators can improve forms and review processes without moving the community root key. Users can still browse the community and understand what capabilities they can unlock.

Good UX is essential. The process should feel like requesting a community capability, not filing paperwork. The app should keep inaccessible actions visible, explain the missing permission, and route the user to a single place where requests, grants, and rejections are understandable.
