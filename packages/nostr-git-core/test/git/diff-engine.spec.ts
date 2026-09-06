import {execFileSync} from "node:child_process"
import {mkdtempSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {describe, expect, it} from "vitest"

import {
  describeGitTreeChanges,
  renderGitDiffChanges,
  requiredGitDiffBlobOids,
  type GitDiffTreeEntry,
} from "../../src/git/diff-engine.js"

const encoder = new TextEncoder()
const oid = (value: string) => value.repeat(40)
const entry = (
  path: string,
  objectId: string,
  mode = "100644",
  type: GitDiffTreeEntry["type"] = "blob",
): GitDiffTreeEntry => ({path, oid: objectId, mode, type})

describe("transport-independent Git diff engine", () => {
  it("renders root files without counting a trailing newline as an extra line", () => {
    const fileOid = oid("a")
    const descriptors = describeGitTreeChanges(
      new Map(),
      new Map([["README.md", entry("README.md", fileOid)]]),
    )
    const changes = renderGitDiffChanges(
      descriptors,
      new Map([[fileOid, encoder.encode("first\nsecond\n")]]),
    )

    expect(changes).toEqual([
      expect.objectContaining({
        path: "README.md",
        status: "added",
        diffHunks: [
          expect.objectContaining({
            oldLines: 0,
            newLines: 2,
            patches: [
              {line: "first", type: "+"},
              {line: "second", type: "+"},
            ],
          }),
        ],
      }),
    ])
  })

  it("treats gaining or losing the final newline as a real one-line change", () => {
    const oldOid = oid("a")
    const newOid = oid("b")
    const descriptors = describeGitTreeChanges(
      new Map([["note.txt", entry("note.txt", oldOid)]]),
      new Map([["note.txt", entry("note.txt", newOid)]]),
    )
    const [change] = renderGitDiffChanges(
      descriptors,
      new Map([
        [oldOid, encoder.encode("same\n")],
        [newOid, encoder.encode("same")],
      ]),
    )

    expect(change.diffHunks[0]).toMatchObject({oldLines: 1, newLines: 1})
    expect(change.diffHunks[0].patches).toEqual([
      {line: "same", type: "-"},
      {line: "same", type: "+"},
    ])
  })

  it("keeps mode-only and submodule pointer changes even without blob reads", () => {
    const fileOid = oid("a")
    const oldSubmodule = oid("b")
    const newSubmodule = oid("c")
    const descriptors = describeGitTreeChanges(
      new Map([
        ["script.sh", entry("script.sh", fileOid, "100644")],
        ["vendor/lib", entry("vendor/lib", oldSubmodule, "160000", "submodule")],
      ]),
      new Map([
        ["script.sh", entry("script.sh", fileOid, "100755")],
        ["vendor/lib", entry("vendor/lib", newSubmodule, "160000", "submodule")],
      ]),
    )

    expect(requiredGitDiffBlobOids(descriptors)).toEqual([])
    expect(renderGitDiffChanges(descriptors, new Map())).toEqual([
      expect.objectContaining({
        path: "script.sh",
        status: "modified",
        oldMode: "100644",
        newMode: "100755",
        diffHunks: [],
      }),
      expect.objectContaining({
        path: "vendor/lib",
        status: "modified",
        submodule: true,
        oldOid: oldSubmodule,
        newOid: newSubmodule,
        diffHunks: [
          expect.objectContaining({
            patches: [
              {line: `Subproject commit ${oldSubmodule}`, type: "-"},
              {line: `Subproject commit ${newSubmodule}`, type: "+"},
            ],
          }),
        ],
      }),
    ])
  })

  it("pairs exact moves as renames instead of delete-plus-add", () => {
    const fileOid = oid("d")
    const descriptors = describeGitTreeChanges(
      new Map([["old-name.txt", entry("old-name.txt", fileOid)]]),
      new Map([["new-name.txt", entry("new-name.txt", fileOid)]]),
    )

    expect(renderGitDiffChanges(descriptors, new Map())).toEqual([
      expect.objectContaining({
        path: "new-name.txt",
        oldPath: "old-name.txt",
        status: "renamed",
        diffHunks: [],
      }),
    ])
  })

  it("matches native Git exact-content rename detection", () => {
    const dir = mkdtempSync(join(tmpdir(), "budabit-diff-rename-"))
    const git = (...args: string[]) =>
      execFileSync("git", args, {cwd: dir, encoding: "utf8"}).trim()

    try {
      git("init", "-q")
      git("config", "user.name", "Budabit Test")
      git("config", "user.email", "test@example.com")
      writeFileSync(join(dir, "old-name.txt"), "same content\n")
      git("add", "old-name.txt")
      git("commit", "-qm", "base")
      const base = git("rev-parse", "HEAD")
      const blobOid = git("rev-parse", `${base}:old-name.txt`)

      renameSync(join(dir, "old-name.txt"), join(dir, "new-name.txt"))
      git("add", "-A")
      git("commit", "-qm", "rename")
      const head = git("rev-parse", "HEAD")

      expect(git("diff", "--find-renames=100%", "--name-status", base, head, "--")).toBe(
        "R100\told-name.txt\tnew-name.txt",
      )
      const changes = renderGitDiffChanges(
        describeGitTreeChanges(
          new Map([["old-name.txt", entry("old-name.txt", blobOid)]]),
          new Map([["new-name.txt", entry("new-name.txt", blobOid)]]),
        ),
        new Map(),
      )
      expect(changes).toEqual([
        expect.objectContaining({
          status: "renamed",
          oldPath: "old-name.txt",
          path: "new-name.txt",
        }),
      ])
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it("marks content-detected binaries and fails rather than hiding missing blobs", () => {
    const binaryOid = oid("e")
    const missingOid = oid("f")
    const binaryDescriptors = describeGitTreeChanges(
      new Map(),
      new Map([["payload.dat", entry("payload.dat", binaryOid)]]),
    )
    expect(
      renderGitDiffChanges(binaryDescriptors, new Map([[binaryOid, new Uint8Array([1, 0, 2])]])),
    ).toEqual([expect.objectContaining({binary: true, diffHunks: []})])

    const missingDescriptors = describeGitTreeChanges(
      new Map(),
      new Map([["missing.txt", entry("missing.txt", missingOid)]]),
    )
    expect(() => renderGitDiffChanges(missingDescriptors, new Map())).toThrow(
      `Git blob ${missingOid} required for missing.txt is unavailable`,
    )
  })
})
