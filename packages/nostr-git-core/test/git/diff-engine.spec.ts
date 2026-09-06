import {execFileSync} from "node:child_process"
import {mkdtempSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {describe, expect, it} from "vitest"

import {
  buildModifiedFileDiffHunks,
  describeGitTreeChanges,
  renderGitDiffChanges,
  requiredGitDiffBlobOids,
  summarizeGitDiffChanges,
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
    expect(change.stats).toEqual({additions: 1, deletions: 1, total: 2})
  })

  it("emits deterministic three-line context hunks for separated edits", () => {
    const oldLines = Array.from({length: 30}, (_, index) => `line ${index + 1}`)
    const newLines = [...oldLines]
    newLines[5] = "changed 6"
    newLines[25] = "changed 26"

    const hunks = buildModifiedFileDiffHunks(`${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`)

    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({oldStart: 3, oldLines: 7, newStart: 3, newLines: 7})
    expect(hunks.flatMap(hunk => hunk.patches).map(patch => patch.line)).not.toContain("line 15")
    expect(hunks.flatMap(hunk => hunk.patches).filter(patch => patch.type === "+")).toHaveLength(2)
    expect(hunks.flatMap(hunk => hunk.patches).filter(patch => patch.type === "-")).toHaveLength(2)
  })

  it("uses zero-line unified-diff coordinates for context-free insertions and deletions", () => {
    expect(buildModifiedFileDiffHunks("a\nb\n", "x\na\nb\n", 0)).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        patches: [{line: "x", type: "+"}],
      },
    ])
    expect(buildModifiedFileDiffHunks("x\na\nb\n", "a\nb\n", 0)).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 0,
        newLines: 0,
        patches: [{line: "x", type: "-"}],
      },
    ])
  })

  it("keeps a one-line edit payload bounded independently of file length", () => {
    const oldLines = Array.from({length: 10_000}, (_, index) => `line ${index + 1}`)
    const newLines = [...oldLines]
    newLines[4_999] = "changed middle"

    const hunks = buildModifiedFileDiffHunks(`${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`)

    expect(hunks).toHaveLength(1)
    expect(hunks[0].patches).toHaveLength(8)
    expect(JSON.stringify(hunks).length).toBeLessThan(1_000)
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

  it("summarizes per-file statistics without rescanning at the caller", () => {
    const firstOid = oid("1")
    const secondOid = oid("2")
    const changes = renderGitDiffChanges(
      describeGitTreeChanges(
        new Map(),
        new Map([
          ["first.txt", entry("first.txt", firstOid)],
          ["second.txt", entry("second.txt", secondOid)],
        ]),
      ),
      new Map([
        [firstOid, encoder.encode("one\ntwo\n")],
        [secondOid, encoder.encode("three\n")],
      ]),
    )

    expect(changes.map(change => change.stats)).toEqual([
      {additions: 2, deletions: 0, total: 2},
      {additions: 1, deletions: 0, total: 1},
    ])
    expect(summarizeGitDiffChanges(changes)).toEqual({additions: 3, deletions: 0, total: 3})
  })
})
