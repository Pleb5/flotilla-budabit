# Budabit Moderator Promotion Flow

This document describes the moderator promotion request flow for Communikey communities.

## Goals

- Let users request moderator authority per content section.
- Keep requests protocol-native and lightweight.
- Let the community pubkey accept or reject requests without using application forms.
- Preserve existing section authorities when accepting a new moderator.
- Surface pending requests clearly in admin navigation and admin UI.

## Non-Goals

- This flow does not use `kind:1069` form responses.
- This flow does not replace regular publishing access applications.
- This flow does not remove existing moderators.
- This flow does not transfer community ownership.

## Request Shape

A moderator promotion request is a requester-authored empty `kind:30000` profile list.

The event MUST tag the community and requested section.

### Profile List Event

```json
{
  "kind": 30000,
  "pubkey": "<requester-pubkey>",
  "tags": [
    ["d", "<deterministic-community-section-moderator-id>"],
    ["a", "10222:<community-pubkey>:", "<community-relay>"],
    ["content", "<section-name>"]
  ],
  "content": ""
}
```

## Request States

- `not-requested`: no valid requester-owned profile-list request exists for the section.
- `pending`: a valid profile-list request exists, latest `kind:10222` does not reference it, and there is no active rejection.
- `rejected`: a valid profile-list request exists, latest `kind:10222` does not reference it, and the community pubkey has an active `-` reaction on the request event.
- `accepted`: latest `kind:10222` references the requester-owned profile-list ref for the section.
- `already-moderator`: requester perspective label for `accepted`.

Accepted moderators become section authorities for admission and event-level moderation in their granted section. Person-level moderation is stronger and only counts when performed by the community admin or by a current moderator with grant capability for every section in the latest community definition.

## Reaction Rules

The community pubkey reviews requests using reactions against the request event.

- Reject: publish a `kind:7` reaction with `content = "-"` against the request event.
- Accept: publish `kind:5` delete events for active review reactions, publish a `kind:7` reaction with `content = "+"` against the request event, and publish a new `kind:10222` that appends the profile-list ref to the requested section.
- Clear rejection: publish `kind:5` delete events for the community pubkey's active `-` reactions.

Deleted reactions MUST be ignored when deriving request state. If the admin changes their mind after rejecting, they can still accept the original request. Accepting performs the reaction cleanup and publishes the approval artifacts in one action. The applicant does not publish another request.

## Access Page UX

Add a section at the bottom of `/c/[community]/access` named `Moderator promotion requests`.

- Show one card per content section.
- `Request moderator role` publishes the requester-owned empty profile list.
- Cards show `Not requested`, `Pending`, `Rejected`, or `Already moderator`.
- If rejected, keep the requester blocked from publishing another moderator request. The admin can still grant the original request later.

## Admin Page UX

Add tabs to `/c/[community]/admin`:

- `Community settings`
- `Moderator requests`

The `Moderator requests` tab contains filters for:

- `Pending`
- `Accepted`
- `Rejected`

Pending requests show requester profile, section, list ref, and actions:

- `Accept`
- `Reject`

Accepted requests show the moderators already appended to `kind:10222`.

Rejected requests support:

- `Accept` to delete active review reactions, publish an approval reaction, and flip the original request from rejected to approved.

## Navigation Highlights

- Derive pending moderator request count from active community request events.
- Highlight `/admin` in `CommunityMenu` using existing `SecondaryNavItem notification`.
- Show a badge on the `Moderator requests` admin tab with the pending count.
- Optionally show a warning badge in the admin page header when pending requests exist.

## Acceptance Validation

Before accepting, validate:

- Requested section still exists.
- Profile list is authored by the requester.
- The event tags the active community definition address.
- The event tags the requested section name.
- Latest `kind:10222` does not already include the profile-list ref in that section.

Acceptance MUST append the requester refs and MUST NOT overwrite existing section refs.

## Implementation Steps

1. Add core helpers for request event creation, parsing, state derivation, acceptance, rejection, and rejection clearing.
2. Add unit tests for request parsing, pending/accepted/rejected state, deleted reaction handling, and 10222 append behavior.
3. Extend community state to load request events and review/delete reactions from active community relays.
4. Add requester cards to `/c/[community]/access`.
5. Add admin tabs and request review UI to `/c/[community]/admin`.
6. Add pending-count notification to `CommunityMenu` admin item.
