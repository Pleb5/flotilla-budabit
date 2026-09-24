# Release widget storage

The host wire format is:

```ts
// Requests
{ key, repoScoped: true, expectedRepoAddress }                 // storage:get
{ key, repoScoped: true, expectedRepoAddress, data }           // storage:set
{ key, repoScoped: true, expectedRepoAddress, expectedPubkey, withRevision: true } // journal get
{ key, repoScoped: true, expectedRepoAddress, expectedPubkey, expectedRevision, data } // compareAndSet
// Responses
{ status: 'ok', data }                                        // get; null when missing
{ status: 'ok' }                                              // set
{ status: 'ok', data, revision, atomic: true }                  // versioned get
{ status: 'ok', revision }                                    // compareAndSet
{ status: 'conflict' }                                        // no mutation; refresh recovery
{ error: '...' }                                              // failure
```

SDK 0.2.0 storage declarations use `value`; the Budabit runtime uses **`data`**. The widget's adapter deliberately follows runtime behavior. Ordinary `storage:set` with `data:null` removes a scoped entry, but publication journals exclusively use conditional `storage:compareAndSet`. Storage is local to the browser/host origin, not a relay or cross-device synchronization API.

- `verified-releases-v2`: at most 100 release events and roughly 500 KB, with exact repository address and a one-day timestamp bound. Signatures and current authority are checked on read; applications are always discovered live. Cache misses/errors are recoverable.
- `release-publication-v1:<publisher>`: one active fixed, fully signed batch plus acceptance progress, scoped to widget/repository/account. New batches have a unique `batchId`; a separate opaque `revision` token is held in memory, not persisted inside the batch. At most 50 assets plus application/release. Storage failure before initial publication prevents relay writes. Partial/unknown relay publication preserves the batch for retry. The host's total value limit is 1 MiB; oversized batches fail before publication.

Host keys include the exact repository coordinate, not the display name. Expected repository/account fields reject stale writes after a context switch, including a switch while waiting for a storage lock. The journal is reverified when loaded and before every publication attempt, including same-session resume. Its embedded application, if present, is merged with current discovered revisions before linkage authorization. Incomplete discovery or a newer revocation blocks writes. Resume deliberately resends all IDs rather than trusting local ACK markers.

The host revision binds the exact stored JSON bytes (SHA-256); null means no entry. Initial save is compare-and-set against null, so two concurrent preparations cannot overwrite one another. Publication checks ownership before the first remote write, updates progress conditionally, and deletes only the final observed revision on success. Delayed replies cannot recreate a cleared slot or overwrite/delete a different batch. Concurrent retries of the same batch may conflict, but only resend that batch's fixed IDs. On any ownership conflict, the UI refreshes recovery state instead of adopting the replacement batch for automatic publication or discard.

Host `28ba443db` serializes compare-and-set, ordinary mutations and legacy read migrations under the same per-key Web Lock across tabs. Atomic callers require runtime support; no read-then-write fallback is permitted. Existing schema-1 journals without `batchId` are independently validated and assigned `legacy:<release-event-id>` in memory; their first conditional save adds that identity without resigning. No journal is silently migrated/deleted on validation failure. Close/reload old host/widget tabs when deploying: old unconditioned callers and direct browser-storage edits do not provide this ownership protocol.

An invalid journal is not silently deleted. The creation view offers **Retry recovery** and, only after obtaining a pinned revision, **Discard local recovery data**, followed by **Keep recovery data** / **Confirm discard**. This also works for a corrupt raw-JSON snapshot. Confirmed discard rechecks the active repository/account and atomically removes only the revision the user reviewed. A stale confirmation reports a conflict, refreshes to the current batch and requires fresh consent. A transport failure without a readable revision offers retry, not unpinned deletion. Storage failure keeps recovery available. Discard does not remove cached releases or anything from relays, and prevents retrying that batch's original signed IDs unless a separate copy exists.

Storage atomicity does not make relay publication atomic or cancel work already running in another tab. Explicitly discarding a batch may race an in-flight publish; its later progress/cleanup fails safely rather than damaging a newer journal. Browser crashes, quota errors, clearing site data and manual storage edits remain outside durable-recovery guarantees.

These entries contain public metadata but are not encrypted. Do not store credentials or confidential release notes. Clearing browser storage loses resume state; it does not undo any already-published event.
