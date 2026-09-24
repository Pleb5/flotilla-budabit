# Releases repository tab

This widget targets `repo-tab` with label **Releases** and path **releases**. Budabit renders it at `/git/<naddr>/extensions/releases` when installed and enabled for that surface.

The host must provide exact repository identity, declared repository relays, current maintainers and viewer updates. A display-name change is not a repository change. Without valid repository relay authority the host disables the surface; without context the widget waits instead of guessing an identity.

The actual repo-tab iframe has its own lifecycle, sandbox and origin handling. Do not substitute behavior from an ordinary embedded `WidgetFrame` or generic chat slot. See the [bridge contract](host-bridge.md) for readiness, explicit clears, capabilities, popup/download permissions and redirect policy.
