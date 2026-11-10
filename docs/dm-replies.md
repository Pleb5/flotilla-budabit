# Private message replies

Reference: Freedom Builders Android code 104, source
`2de4d49ba8090b54abafc5a5a5a217ee268953e5`, `rust/dm.rs` send path and
`android/app/src/main/java/tech/freedom/builders/{MessagesPanel,DirectMessages}.kt`.

Replies remain kind 4444 with NIP-44-encrypted message text, one recipient `p`
tag, and `['e', originalNativeEventId, '', 'reply']`. Quotes are not copied into
public tags or message content. The parent must belong to the signed-in account's
current one-to-one conversation. Publication continues to use the participants'
signed inbox lists, with the existing signed-event retry mechanism.

The message menu offers Reply on pointer/keyboard and touch. The composer shows
a two-line plaintext parent preview with its locally cached author name and a
cancel action. Attachment uploads lock reply selection while a submission is in
flight. A failed send retains both editor content and selected parent; retry uses
the retained event. A successful send clears the selection and reveals the latest
message window.

Each editor/attachment edit advances the local draft revision, including editing
back to the same text. A submission captures its text, tags, attachment set and
revision before upload. Its ACK clears the composer and reply only if that
revision is still current; newly typed text remains editable and is preserved.
Destroying the account/conversation composer invalidates pending upload callbacks.
Retry identity includes account, peer, parent and draft revision, but never the
current inbox relay lists: an unchanged failed submission reuses its saved signed
event and destination snapshot even after participant inbox updates.

Rendered quotes use only loaded same-conversation events and local decryption,
with no rich-content renderer or profile fetch. Clicking a loaded parent reveals
a bounded existing message window. Missing parents say “Original message
unavailable”; the quote initiates no history or arbitrary-author query. Existing
manual history controls remain available. Multiple explicit parents, malformed
IDs, and self references are ignored.

The existing web editor has no durable DM draft model; reply selection has the
same component lifetime and resets on account/conversation changes. Android
persists its reply target alongside its existing encrypted account/peer draft.

Verification: `dm-replies.test.ts` exercises signed synthetic NIP-44 events,
native IDs, malformed/ambiguous tags, and conversation binding. The targeted
`tests/e2e/dm-replies.spec.ts` uses intercepted relay traffic and disposable
identities for desktop/touch selection, cancel, parent navigation, encrypted
send/ACK, failed-send retry without a second event ID, and conversation switching.
No real messages are sent by these fixtures.
