# Extension template workspace provenance

Converted from Budabit's former Git submodule to ordinary tracked source:

- Source: `https://github.com/Pleb5/flotilla-extension-template.git`
- Revision: `861024424feba424f81dffcf4a6f8e8fbb8f878f`
- Original license: MIT, retained in `LICENSE`.

This is the Budabit-specific template/SDK fork that was pinned by the host,
including its community and visibility contracts. Its package version is not a
claim of equivalence to a differently versioned SDK published elsewhere.

The SDK, shared bridge, manifest tools, scaffold CLI, and template application
are all root workspace members. Releases and Pipelines use the local SDK via
`workspace:*`; the install lifecycle builds its exports before consumers use it.
Changes belong in Budabit PRs, with the consumer regression tests run together.
Manifest CLI entrypoints resolve workspace symlinks so the local pnpm bin shims
execute normally; Releases' offline manifest tests exercise that consumer path.

The standalone workspace/lockfile and inactive nested CI were removed. The
scaffold under `packages/create-budabit-widget/template/` deliberately keeps its
own workspace configuration: it generates independent widget projects and is
excluded from Budabit's workspace discovery.

For a checkout predating this conversion, save any local template commits/edits
and deinitialize its clean submodule before rebasing across the conversion. See
the root `CONTRIBUTING.md` migration instructions.
