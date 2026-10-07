# Attachment file metadata publication

2026-10-07 · Send-time kind-1063 publication for non-DM attachments.

Successful uploads record their actual downloadable `sha256`, URL, size and MIME
type. Original/pre-transformation `ox` is separate from final-byte `x`. Merely
uploading, preparing a draft or using the shared DM editor does not publish a file
event. Inline metadata remains on parent content for rendering.

The shared publication observer receives a signed parent and its actual publication
relay scope after a relay ACK. Community direct-publish paths notify the same
observer. Referenced editor files, profile picture/banner URLs and associated
image/cover tags are eligible; unrelated uploads are not. Budabit DMs (4444) and
other private/wrapped kinds are excluded explicitly.

`budabit/file-publications:v1` is an application-specific local journal, not a
Nostr standard. It retains upload descriptors, parent associations, immutable signed
metadata, exact relay scope and per-relay ACKs. Equal bytes/URL in the same scope
reuse the retained event; a different community/relay scope is independent.
Retry sends the saved event to remaining relays, without another byte upload.

**Publication recovery** surfaces pending metadata even after reload. Loading the
journal does not retry it. Stop/account switching cancels active metadata work.
The accepted parent remains successful when metadata fails. Missing publication
relays yields “File uploaded, but other apps may not discover it yet.” No extra
relay is inferred by the file-event follow-up.

Verification: six journal tests plus the focused attachment/commands/Blossom/
community suite (152 total) passed; `pnpm check` passed. The focused Chromium
room-send → rejected file event → reload → immutable retry test passed on the full
development stack, and pending/recovered screenshots were inspected. Its relay,
account and file URL are synthetic; this is not evidence of live publication.
