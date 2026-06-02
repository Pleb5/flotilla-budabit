# Nostr-Git Extension v0.2.0

Date: 2025-08-12

This minor release focuses on UX polish, safety confirmations, and build hygiene. Chrome MV3 and Firefox MV2 bundles are attached to the GitHub release.

## Highlights

- Confirmation dialogs before publishing repo announcements and permalinks (including context menu).
- Snackbars: persistent until dismissed, auto-dismiss (5s success/error, 3s cancel), fade/slide, respects reduced-motion.
- Clickable full URL+nevent in snackbars; added "Copy" button to copy link instantly.
- Viewer base URL setting in popup with normalization (ensures scheme and trailing slash). Default: https://njump.me/.
- Popup refreshed UI with dark mode and a11y polish; focus restoration for menu actions.
- Compile-time debug toggle; release builds hide the Debug option via `NOSTR_GIT_SHOW_DEBUG=false`.

## Developer Notes

- MV3 CSP compliance: removed inline script from `packages/extension/src/popup.html`; early toggle handled in `packages/extension/src/popup.ts`.
- Unit tests added for viewer base normalization and clipboard fallback; E2E tests cover confirmations, snackbar link, reduced-motion, and timing.
- Minimal permissions remain intact (Chrome: `storage`; Firefox: `tabs`, `storage`, `clipboardWrite`, `activeTab`).

## Installation

- Chrome: upload/install `packages/extension/extension-chrome.zip` (or from the Web Store once approved).
- Firefox: upload/install `packages/extension/extension-firefox.zip` (or from AMO once approved).

## Post-Install Checks

- Popup: Debug option is hidden in release build; Viewer Base Save/Reset works; invalid input shows red outline.
- Permalinks/snippets: Confirm dialog appears; Cancel shows cancel snackbar; Confirm shows snackbar with clickable URL+nevent and Copy button.

## Assets

- `packages/extension/extension-chrome.zip`
- `packages/extension/extension-firefox.zip`
