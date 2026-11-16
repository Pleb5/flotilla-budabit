# Embedded community calls and broadcasts

Community Call and Community Stream stay on the community home page. The call widget embeds HiveTalk; the stream widget plays the provider's HLS output. OBS remains the external encoder and recorder.

## Presentation and permissions

`WidgetFrame` offers **Enlarge**, **Full screen**, and **Back to community** for the `community-call` and `community-stream` identifiers once their content is visible and ready. Enlarge uses the browser's top layer to escape navigation stacking contexts. Fullscreen requests the existing presentation surface; changing presentation does not replace the iframe, reset the bridge, or join a second call. If fullscreen is unavailable, the enlarged view remains usable.

The host delegates `fullscreen *` through widget redirects and nested frames. Camera, microphone, and display capture remain gated by the manifest's explicit `media:*` permissions. The call widget must refresh its restored permissions after the new manifest is installed. Native fullscreen and screen selection still depend on browser/platform support and user consent.

The call has a visible fullscreen action. HiveTalk shared-screen tiles expose **Focus screen**, **Back to call**, and **Full screen**, rather than requiring the hidden video menu. Focus is a viewport-sized fallback within the call iframe. Native screen fullscreen retains the actions and video track.

## Operator workflow

1. Join the embedded call once on each participant device. Use headphones.
2. In OBS capture the call area/window and its playback, plus the operator's microphone exactly once. Avoid capturing the stream preview or unrelated browser content.
3. Leave the operator's Community Stream player muted. Desktop/application audio can recapture its delayed playback even when headphones are used. Callers and locally prepared broadcasters start muted; ordinary viewers request sound, subject to browser autoplay rules. Explicit audio controls remain available.
4. Set OBS monitoring to **Monitor Off**. Verify local recording contains both voices once, including during screen sharing and presentation changes.
5. Start OBS recording and streaming independently. Use explicit Start/Stop hotkeys, not toggles; verify they work while the browser has focus.
6. For unstreamed/unrecorded discussion, stop **both** outputs and confirm neither OBS timer is running. Keep the call connected.
7. Announce before resuming either output.

The page cannot control or verify OBS. No local "private" flag, muted player, ended call listing, or delayed provider event proves recording/streaming has stopped. Viewers may still receive pre-stop buffered footage; call participants can record independently. This is an output-control workflow, not an access-control or confidentiality guarantee.

## Local participation and stream audio

See [community media state](../extensions/community-media.md) for the bridge contract. The host groups ephemeral call signals by exact community address and viewer account on this page, regardless of each iframe's individual context session. The stream subscribes to a current snapshot and ordered changes; stale-context replies are ignored. No pubkeys are used to guess which device runs OBS. A moderator with no local activity is an ordinary viewer.

Opening/joining a call or preparing broadcasting mutes current stream playback. Unchanged state refreshes respect an explicit override. Leaving a call or clearing broadcast protection never automatically unmutes. Unsupported/unknown host state remains muted until a user chooses. A denied audible autoplay attempt falls back to muted playback and explains the required click.

Broadcast preparation is a safety hint, persisted in this tab's host session storage when available and scoped by community/account. It survives widget teardown and page refresh because OBS is external. The operator explicitly clears it after stopping outputs; the action does not stop OBS. Calls are not persisted. Other tabs/apps/devices and participants' independent recordings cannot be detected by this page.

## Release and verification

Deploy the updated Budabit web frontend, publish/refresh both widget artifacts/manifests, and deploy HiveTalk's updated assets. A widget-only release does not supply the new host presentation controls; a host-only release does not restore the call widget's media permissions. VPS deployment remains an operator step.

Focused checks:

- Widget call suite: nested permissions, stable connection on polling/fullscreen, leave/rejoin, context/expiry handling, and denied-publication cleanup.
- `playwright.community-call.config.ts`: actual Community Home, bridge, production widget artifact, mock relays, top-layer enlargement and fullscreen with stable iframe identity.
- `playwright.community-presentation.config.ts`: cross-origin stream fullscreen, muted audio controls, synthetic-video continuity, and direct screen-share focus/fullscreen on desktop/mobile Chromium.
- HiveTalk tests retain the initiator-audio producer-discovery regression and cover visible screen controls and fullscreen failure.

These fixtures use no personal accounts, public publishing, real media devices, or OBS. Live acceptance requires real two-way audio in the nested call, screen sharing between two participants, retained audio after fullscreen changes, simultaneous OBS recording/streaming, and verified stopping of both outputs. Mobile-emulated Chromium is not physical Safari verification.
