# Widget visibility and loading

A placeholder promises that a widget belongs in this position for the current
viewer. Budabit establishes visibility before showing a placeholder. Discovery,
authorization, iframe initialization, content loading, and sizing are separate
stages; completing one does not imply that the others have completed.

## Manifest policy

The signed kind-30033 manifest may contain one tag:

```json
["visibility", "host"]
```

`host` is the default for existing manifests. Budabit may show loading feedback
after confirming the exact community, authority evidence, curation or authorized
shared-config placement, installation, and enablement. An unknown catalog does
not produce speculative placeholders. A known usable launcher is rendered as a
button immediately; its iframe loads only after the user opens it.

Use `widget` when the entire inline surface depends on additional data or role
checks, as Community Call does:

```json
["slot", "community-home-before-quicklinks", "Community call"]
["visibility", "widget"]
```

Generate it with `budabit-generate ... --visibility widget`. This version supports
widget-controlled visibility on the two **inline community home slots** (before
and after quicklinks). Quicklinks, global-menu/chat launchers, repository tabs,
and manually opened previews use host-determined placement. They do not run
hidden iframe probes to decide whether a button/tab exists. The generator and
host parser reject `widget` on unsupported slots.

Choose host visibility when the widget always has a meaningful panel, including
an empty/offline state. Calendar and Stream currently do. Choose widget visibility
when no panel should exist for some viewers or data states. Widget visibility
does not grant permission to read data, publish, or join a call; bridge policy
continues to enforce those operations independently.

## Hidden initialization

Once host eligibility is established, a widget-controlled iframe starts in a
zero-space, invisible, inert surface. Its viewport remains measurable. No
skeleton, padding, focusable content, or error panel is shown while its decision
is pending or hidden. Register handlers and call `signalReady()` normally.

Hidden/offscreen frames can have throttled animation frames and ResizeObserver
callbacks. Do not depend solely on those to complete visibility checks. Use
asynchronous data requests and a bounded timer fallback for content measurement.

## `ui:setVisibility`

Check **both** `init.capabilities.actions` for `ui:setVisibility` and
`init.capabilities.surface.visibility === true`. The host also advertises
`features["widget.visibility"] === true`; that feature alone does not indicate
that the current surface accepts the action.

```ts
const context = init.communityContext
if (
  context &&
  init.capabilities?.surface?.visibility &&
  init.capabilities.actions.includes("ui:setVisibility")
) {
  const result = await bridge.setVisibility("visible", context)
  if ("error" in result) return
  // Measure the actual rendered content and request ui:resize separately.
}
```

Wire request:

```ts
{
  visibility: 'pending' | 'visible' | 'hidden',
  contextSessionId: string,
  contextVersion: number
}
```

Success is `{status: 'ok'}`. Invalid/stale context returns an error (including
`STALE_WIDGET_CONTEXT`); an unsupported surface returns `UNSUPPORTED_CAPABILITY`.
No permission tag is required for this presentation-only action. Messages must
come from the attached iframe and an accepted origin.

| Decision  | Host behavior                                                         |
| --------- | --------------------------------------------------------------------- |
| `pending` | No visible surface; evidence is inconclusive.                         |
| `hidden`  | No visible surface; the current decision is settled.                  |
| `visible` | Reveal content or reserve its position with a named loading skeleton. |

`widget:ready`, browser iframe `load`, and `ui:resize` **never grant visibility**.
`visible` does not mean content has loaded. An inline surface is sized by
`ui:resize`; a visible frame that fails to initialize or supply its first size
retains a usable loading/error area with a Retry control instead of collapsing.

## Contexts, refreshes, and failures

- Report using the exact context against which the decision was made. Capture it
  before asynchronous checks and discard results if that context changes.
- The host invalidates decisions when the community, viewer, context session, or
  context version changes. Iframe reloads also reset decisions.
- Report later transitions, including a call starting or ending. Keep a known
  visible panel during ordinary background refreshes while its evidence remains
  valid; polling alone is not a reason to send `pending`.
- A failed check must not manufacture a positive decision. An unresolved or
  failed hidden surface stays hidden, including after the bounded startup
  deadline. It may report a valid decision later. The host records terminal
  failure for diagnostics without promising content to the viewer.
- Re-report after initialization/reconnection. Await ACKs and re-measure when a
  hidden surface becomes visible.

## Older hosts and release order

Older hosts may ignore the manifest tag. Widgets must enforce the same local
visibility rules and avoid displaying unauthorized loading/empty/error panels.
They cannot suppress an older host's own skeleton. Deploy host support first,
then publish the new widget manifest and bundle. Keep capability checks so the
bundle also works on older hosts without unsupported requests.

## Current choices and regression checks

Community Call uses `widget`: a positively known moderator or live call produces
a panel; a settled idle non-moderator is hidden; unresolved checks remain pending.
Seeing the panel and being able to join the call are separate policies.

Calendar, Stream, Freelance, Classifieds, Kanban, Workflows, and Releases use the
default `host` policy. Test cold/warm discovery, disabled/ineligible widgets,
hidden-to-visible transitions, account/community changes, stale reports,
background refreshes, initialization failures, and missing resize responses.
Check keyboard accessibility, reduced motion, and desktop/mobile layout.
