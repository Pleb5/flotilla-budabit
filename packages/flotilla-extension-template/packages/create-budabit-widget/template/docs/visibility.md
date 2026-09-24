# Visibility before loading

The host must establish that the current viewer should see a widget before it
shows a loading placeholder. The default manifest policy is `visibility=host`,
appropriate for panels with useful empty/offline states and on-demand launchers.

If an inline community panel sometimes should not exist, add
`--visibility widget` to manifest generation. This is supported only with
`community-home-before-quicklinks` and `community-home-after-quicklinks`.
The iframe initializes invisibly after host eligibility checks.

Register handlers before `bridge.signalReady()`. Keep local content hidden until
your own checks positively establish visibility. Report decisions for the exact
context used by those checks:

```ts
let currentContext: CommunityWidgetContext | undefined;
let visibilitySupported = false;

async function update(context: CommunityWidgetContext | undefined) {
  currentContext = context;
  if (!context) return;
  // Application-specific, returns 'pending', 'visible', or 'hidden'.
  const decision = await determineVisibility(context);
  if (currentContext !== context) return;
  if (visibilitySupported) {
    const result = await bridge.setVisibility(decision, context);
    if ('error' in result) return;
    // Measure rendered content and request ui:resize separately.
  }
}

bridge.onEvent('widget:init', init => {
  visibilitySupported = Boolean(init.capabilities?.surface?.visibility &&
    init.capabilities.actions.includes('ui:setVisibility'));
  return update(init.communityContext);
});
bridge.onEvent('community:contextChanged', change => update(change.communityContext));
bridge.signalReady();
```

`pending` and `hidden` consume no visible space. Only `visible` permits a
placeholder, content, or retry UI. A failed/inconclusive check stays invisible.
`widget:ready`, iframe load, and resize do not grant visibility or authorization.
Call the same update logic when relevant data changes; ordinary background
refreshes should preserve a valid established surface.

The SDK binds reports to `contextSessionId` and `contextVersion`. The host rejects
stale reports and invalidates decisions across community/account/context changes
and reloads. Re-measure after a visibility ACK. Hidden frames can throttle
animation frames, so use data promises and timer-backed measurement too.

Older hosts may ignore the manifest tag. Enforce local visibility rules there,
and only call the new action when advertised. Deploy host support before the
widget; the widget cannot suppress an older host's own placeholder.

Test visible and hidden viewers, delayed/failed checks, stale reports, account
switches, runtime transitions, retries, missing resize responses, and refreshes
at desktop/mobile widths.
