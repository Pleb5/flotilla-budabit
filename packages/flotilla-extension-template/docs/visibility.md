# Visibility before loading

Budabit shows a placeholder only after establishing that the current viewer
should see the surface. Use `--visibility host` (the legacy/default behavior) for
widgets with a meaningful loaded, empty, or offline panel. Known usable launchers
appear immediately and load their iframe on click.

For an inline community widget that may disappear entirely, declare:

```json
["slot", "community-home-before-quicklinks", "Community call"]
["visibility", "widget"]
```

`--visibility widget` is supported on the before/after quicklinks inline slots.
Launchers, repository tabs, and manually opened previews use host placement;
unsupported manifest combinations are rejected. This avoids loading a workspace
just to decide whether to show its button.

After host eligibility checks, the iframe initializes invisibly with zero layout
space. Register handlers and call `signalReady()` normally. Determine whether the
viewer has a panel before displaying local loading/error content.

```ts
bridge.onEvent('widget:init', async (init) => {
  const context = init.communityContext;
  if (!context) return;
  // Capture this context. Discard the asynchronous result if it has changed.
  const visibility = await determineVisibility(context);
  if (
    init.capabilities?.surface?.visibility &&
    init.capabilities.actions.includes('ui:setVisibility')
  ) {
    const result = await bridge.setVisibility(visibility, context);
    if ('error' in result) return;
    // Request ui:resize for the rendered content separately.
  }
});
bridge.signalReady();
```

`determineVisibility` is your application logic. Decisions are `pending`,
`visible`, and `hidden`. The SDK sends `contextSessionId` and `contextVersion`
from the supplied context. The host rejects stale reports and reports from
unattached frames. This presentation action needs no permission tag and does not
grant access to any privileged bridge operation.

- Only `visible` reveals a panel or skeleton. Failed/inconclusive authorization
  or availability checks remain pending and invisible.
- `widget:ready`, iframe `load`, and `ui:resize` do not establish visibility.
- Report changes when eligibility or data changes. Community/account/session/
  version changes invalidate the previous decision; reloads also reset it.
- Keep established visibility during routine refreshes while evidence remains
  valid. Do not hide and re-show the panel on every poll.
- Hidden frames can throttle animation frames: use data promises and a timer
  fallback for sizing, and re-measure after a successful visibility ACK.
- Check `surface.visibility` and the action catalog. Older hosts may ignore the
  tag; enforce your local rules there too. The widget cannot suppress the older
  host's placeholder. Deploy host support before the new widget manifest.
- Startup failure never reveals a previously unknown widget. Visible widgets
  retain a usable retry area when loading or the initial resize times out.

Community Call is the widget-controlled example: show for an established
moderator or live call; hide a settled idle viewer; keep unresolved checks pending.
Calendar/Stream retain empty/offline panels and therefore use host visibility.

Test both hidden and visible users, delayed/failed checks, stale context reports,
account switches, call start/end transitions, retries, missing resize responses,
and background refreshes on desktop and mobile.
