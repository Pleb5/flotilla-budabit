# Releases workspace provenance

Imported as ordinary tracked source from the standalone Budabit Releases repository:

- Source: `https://grasp.budabit.club/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/budabit-releases-extension.git`
- Revision: `8d85077f15a65f4579814e03eac9b1e85f7f058d`
- Original license: MIT, retained in `LICENSE`.

Budabit now owns changes in this directory. Submit source, host-bridge, and widget
changes together in a Budabit PR against `dev`; there is no submodule pointer or
automatic synchronization with the source repository.

Integration changes: use the root pnpm 10.12.4 workspace and lockfile, link
`budabit-sdk` from the in-tree template, align Vitest with the host runner, and
scope recursive scripts to this extension's children. Root CI covers these
packages; the former standalone CI/tag-publishing workflows were not imported.
The release-list subscription uses the host-assigned ID required by this SDK.

Only committed source was imported. Local session notes, credentials, build
outputs, dependency trees, and Git metadata are not part of the import.
