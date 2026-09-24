# Signed-release security policy

## Trust chain

1. Budabit supplies the exact repository coordinate and current owner/maintainers. The host and its repository authority are part of the trust boundary.
2. The widget verifies serialized Nostr event signatures itself, without inheriting cached verification flags. Internally owned events and their tags are immutable; a module-private WeakSet permits reusing their verified state without redoing cryptography on every authorization check. Raw copies and matching IDs do not inherit trust.
3. An application must be signed by a current owner/maintainer and carry the exact repository `a` link. URL basenames, shared display names and owner-key substrings never establish identity.
4. A release must be signed by a current owner/maintainer and link exactly to a discovered application via `32267:<publisher>:<identifier>`. Its `i`, `version`, `d` and channel/reference metadata must agree. An unrelated key cannot gain release authority by copying `i`.
5. Addressable replacements are reconciled by `(kind,pubkey,d)`, newest timestamp then lowest ID. Replacements are processed before authorization filtering, so removing an application/release link removes an older authorized revision from view. The authority controller remains active across navigation, including open detail; asset replies cannot restore revoked detail.
6. Asset signatures and IDs are verified. A maintainer's explicit release reference endorses the referenced metadata; assets may have different publishers, identifiers and versions. Their bytes remain a separate verification step.

Legacy unlinked releases are excluded. Older cached events are reverified and re-authorized; caches never supply application authority. EOSE is not proof of an honest relay or global latestness. A compromised maintainer or host can still endorse malicious software.

## Pipeline provenance

Run `event.pubkey` must be a current maintainer and equal the `triggered-by` tag. The run must name exactly one repository coordinate (the current repository) and a valid commit. Only its authenticated `publisher` delegation authorizes artifact metadata. Discovery scans current maintainers' kind-5401 events across **all repository scopes** before selecting current-repository runs. Reused publisher keys across discovered delegations are rejected as ambiguous, even when the other run belongs to another repository. If an artifact supplies run/commit references, they must agree with that run.

Legacy artifacts without an `e` tag rely on a unique run-specific ephemeral publisher delegation in that completed maintainer-namespace discovery. Partial discovery fails closed (including for explicitly linked artifacts); never infer a commit from an ambiguous delegation. This is not global proof of key uniqueness: relays may hide history, and delegations from authors outside the current maintainer set are not discovered. This is not independent-worker consensus. The widget does not verify worker identity, workflow execution, Git object existence, reproducibility or the safety of uploaded outputs. Selection is explicitly run-specific, never a historical filename majority.

## Binary and native signatures

Local-file checking computes SHA-256 incrementally in 1 MiB chunks, compares the declared size when available, and refuses files above 512 MiB. It does not upload or execute the file. It confirms only that selected bytes match a signed claim.

The widget does **not** validate APK/native signatures, certificate trust, malware, signed Git tags or reproducible builds. APK publication requires version-code/certificate-hash fields, but these are user-reviewed assertions obtained from a trusted inspection tool, not verification performed by the widget. Empty platform metadata is shown as “Not declared,” never “Universal.”

## Signing safety and uncertain outcomes

The intended account/repository is checked before every signing/publication request. Returned signatures/templates are verified; account/context updates reset the UI and abort further work. All signatures are collected before publication starts, and the fixed signed batch must be saved first. No private account key is sent to the iframe.

A signer prompt already open in the host cannot be canceled by a widget timeout. Publication is sequential and may partially succeed. Every batch attempt (including same-session resume) revalidates signatures/linkage against current application discovery, merging any embedded application as a candidate revision before authorization. Incomplete discovery or a newer revocation prevents starting the batch. A subsequent revocation may still race remote writes; this is not a transaction or proof of global latestness. Resume resends the same signed IDs, never creates replacement signatures based on an uncertain ACK. Local acceptance markers are not authoritative. Journals are local, not encrypted, and contain public signed metadata; do not include secrets in release notes. Invalid journals can be retried or explicitly discarded after a warning that local discard cannot undo publication.

Journal scope is also batch-bound: a unique batch ID plus the exact host storage revision protects initial creation, progress saves, completion and confirmed discard. The host's compare-and-set is serialized across same-origin tabs by Web Locks; it is not a widget-side read-then-write check. Conflicts refresh recovery state and require a new user action. Older hosts lacking atomic support cannot start recovery/creation; valid legacy journals are conditionally migrated without new signatures. Deploy both host `28ba443db` and the updated permission manifest and reload old tabs; direct storage edits and old unconditioned writers are not covered. These locks protect recovery data, not remote work already in flight. See [storage](storage.md).

## Untrusted rendering and embedding

Markdown is parsed then sanitized with a passive element/attribute allowlist. Headings, lists, tables, code and emphasis remain; media, images, embeds, SVG, styles and automatic resource-loading attributes do not. Notes never intentionally load third-party resources on rendering; a browser network regression covers hostile media notes. Asset and notes links permit HTTPS without URL credentials and use a new browsing context only on user activation. Browser popup/download restrictions still apply.

Deploy the widget on a **different origin** from Budabit. Combining `allow-scripts` and `allow-same-origin` does not isolate a same-origin iframe from its parent. The host validates both source window and exact runtime origin and denies undeclared privileged actions. Installing a widget is a trust decision about code, separate from trusting release publishers.

No live account signing, public relay publication, native signature verification, CDN redirect integration or executable downloads are performed by the regression suite. See [verification scope](verification.md).
