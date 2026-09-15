// Opt-in real-core/production-client completeness test. No external connections.
// STRFRY_SOURCE=/path/to/reviewed/strfry pnpm exec vitest run --project=main src/app/core/private-community-native.test.ts
import {afterEach, expect, it, vi} from "vitest"
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from "node:fs"
import {spawn, spawnSync, type ChildProcess} from "node:child_process"
import {once} from "node:events"
import {tmpdir} from "node:os"
import path from "node:path"
import {setTimeout as delay} from "node:timers/promises"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {get} from "svelte/store"
import {pubkey} from "@welshman/app"
import {
  Socket,
  SocketAdapter,
  SocketEvent,
  AuthStatus,
  requestOne,
  socketPolicyConnectOnSend,
} from "@welshman/net"
import {PrivateCommunityAccess} from "./private-community-access"
import {makeCommunityPointer, buildCommunityDefinition} from "./community-protocol"
import {makeCommunityEventReport} from "./community-reports"

const endpoints = {public: "wss://private-native.test/", local: "ws://127.0.0.1:40584/"}
vi.mock("./relay-auth-consent", () => ({
  allowRelayAuthentication: vi.fn(),
  requireExplicitRelayAuthConsent: vi.fn(),
}))
vi.mock("./relay-auth-coordinator", () => ({
  authenticateRelay: vi.fn(),
  cancelRelayAuthentication: vi.fn(),
}))

const source = process.env.STRFRY_SOURCE
const ownerKey = new Uint8Array(32).fill(43),
  otherKey = new Uint8Array(32).fill(44)
const owner = getPublicKey(ownerKey),
  other = getPublicKey(otherKey)
let child: ChildProcess | undefined,
  work: string | undefined,
  control: PrivateCommunityAccess | undefined
afterEach(async () => {
  control?.dispose()
  control = undefined
  pubkey.set(undefined)
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, "exit")
    child.kill("SIGTERM")
    await ended
  }
  child = undefined
  if (work) {
    try {
      process.kill(-Number(readFileSync(path.join(work, "plugin.pid"))), "SIGKILL")
    } catch {
      /* stopped */
    }
    rmSync(work, {recursive: true, force: true})
    work = undefined
  }
})
const until = async (test: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await test()) return
    await delay(25)
  }
  throw Error("Local private relay readiness timed out")
}

it.skipIf(!source).each(["ban", "grant", "deletion"])(
  "does not let inaccessible DMs starve older %s authority",
  async evidence => {
    work = mkdtempSync(path.join(tmpdir(), "private-native-client-"))
    const root = path.resolve(source!),
      binary = path.join(root, "strfry"),
      db = path.join(work, "db")
    mkdirSync(db)
    const community = "b".repeat(64),
      pointer = makeCommunityPointer({ownerPubkey: owner, communityId: community})!
    const config = path.join(work, "strfry.conf"),
      wrapper = path.join(work, "plugin")
    const cap = evidence === "ban" ? 4 : 3
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
    writeFileSync(
      wrapper,
      `#!/bin/sh\necho $$ > ${quote(path.join(work, "plugin.pid"))}\nexec python3 ${quote(path.join(root, "deploy/budabit/read-policy.py"))}\n`,
      {mode: 0o700},
    )
    writeFileSync(
      config,
      `db = "${db}"\nrelay {
    bind = "127.0.0.1"\n port = 40584\n nofiles = 0\n maxFilterLimit = ${cap}\n maxFilterLimitCount = 0
    auth { enabled = true\n serviceUrl = "${endpoints.public}" }
    negentropy { enabled = false }
    readPolicy { plugin = "${wrapper}" }
    info { extra = ${JSON.stringify(JSON.stringify({budabit: {read_control: {version: 2, mode: "members", scope: "relay", unfiltered_kinds: [1, 5, 1984, 30000, 32222]}}}))} }
  }\n`,
    )
    const env = {
      ...process.env,
      BUDABIT_READ_CONTROL: "members",
      BUDABIT_BRANCHES: pointer.address,
      BUDABIT_AUTO_HOST_URL: "",
      BUDABIT_DRY_RUN: "0",
      BUDABIT_DISABLE_LOADER: "0",
      BUDABIT_STRFRY_BIN: binary,
      STRFRY_CONFIG: config,
      STRFRY_POLICY_DB_FILE: path.join(db, "data.mdb"),
      STRFRY_POLICY_MIN_FREE_BYTES: "0",
    }
    const now = Math.floor(Date.now() / 1000)
    const note = finalizeEvent(
      {
        kind: 1,
        created_at: now - 12,
        content: "native retained text",
        tags: [
          ["h", community],
          ["a", pointer.address],
        ],
      },
      otherKey,
    )
    const grant = finalizeEvent(
      {
        kind: 30000,
        created_at: now - 16,
        content: "",
        tags: [
          ["d", `${community}-general`],
          ["p", other],
        ],
      },
      ownerKey,
    )
    const older =
      evidence === "grant"
        ? grant
        : evidence === "deletion"
          ? finalizeEvent(
              {kind: 5, created_at: now - 15, content: "", tags: [["e", grant.id]]},
              ownerKey,
            )
          : finalizeEvent(
              {
                ...makeCommunityEventReport({
                  community: pointer,
                  sectionName: "General",
                  eventId: note.id,
                  eventPubkey: other,
                  eventKind: 1,
                }),
                created_at: now - 17,
              },
              ownerKey,
            )
    const definition = finalizeEvent(
      {
        ...buildCommunityDefinition({
          communityId: community,
          name: "Native private fixture",
          relays: [endpoints.public],
          readAccess: "members",
          sections: [
            {
              name: "General",
              kinds: [{kind: 1}],
              profileLists: [{address: `30000:${owner}:${community}-general`}],
            },
          ],
        }),
        created_at: now - 13,
      },
      ownerKey,
    )
    const dm = finalizeEvent(
      {
        kind: 4444,
        created_at: now - 11,
        content: "inaccessible controlled fixture",
        tags: [["p", other]],
      },
      otherKey,
    )
    const retained = [...(evidence !== "grant" ? [grant] : []), older, definition, note, dm]
    const imported = spawnSync(binary, ["--config", config, "import"], {
      env,
      input: retained.map(event => JSON.stringify(event)).join("\n") + "\n",
      encoding: "utf8",
    })
    expect(imported.status, imported.stderr).toBe(0)
    child = spawn(binary, ["--config", config, "relay"], {env, stdio: "ignore"})
    await until(async () => {
      try {
        return (await fetch("http://127.0.0.1:40584/")).ok
      } catch {
        return false
      }
    })
    const profile = await (
      await fetch("http://127.0.0.1:40584/", {headers: {Accept: "application/nostr+json"}})
    ).json()
    expect(profile.limitation.max_limit).toBe(cap)
    expect(profile.budabit.read_control.unfiltered_kinds).toEqual([1, 5, 1984, 30000, 32222])
    pubkey.set(owner)
    const errors: string[] = []
    control = new PrivateCommunityAccess({pointer, relays: [endpoints.local]}, owner, {
      socket: url => {
        const socket = new Socket(url, [socketPolicyConnectOnSend])
        socket.on(SocketEvent.Error, error => errors.push(String(error)))
        socket.on(SocketEvent.Status, status => errors.push(`status:${status}`))
        return socket
      },
      authenticate: async socket => {
        socket.attemptToOpen()
        await until(() => Boolean(socket.auth.challenge))
        // Raw, matching-ACK-confirmed controlled AUTH supplies the configured
        // public service tag over the loopback transport (no TLS proxy required).
        const proof = finalizeEvent(
          {
            kind: 22242,
            created_at: now,
            content: "",
            tags: [
              ["relay", endpoints.public],
              ["challenge", socket.auth.challenge!],
            ],
          },
          ownerKey,
        )
        let accepted = false
        const received = (message: unknown[]) => {
          if (message[0] === "OK" && message[1] === proof.id) accepted = message[2] === true
        }
        socket.on(SocketEvent.Receive, received)
        try {
          socket.send(["AUTH", proof])
          await until(() => accepted)
        } finally {
          socket.off(SocketEvent.Receive, received)
        }
        socket.auth.setStatus(AuthStatus.Ok)
      },
      request: requestOne,
      profiles: async () => new Map([[endpoints.local, profile]]),
    })
    await control.start()
    await until(async () => {
      if (get(control!.view).access === "unavailable") await control!.start()
      return ["ready", "partial"].includes(get(control!.view).access)
    })
    const view = get(control.view)
    const broad: string[] = []
    let complete = false
    requestOne({
      relay: endpoints.local,
      filters: [{limit: cap}],
      autoClose: true,
      signal: AbortSignal.timeout(5000),
      context: {getAdapter: () => new SocketAdapter(control!.sockets.get(endpoints.local)!)},
      onEvent: event => {
        broad.push(event.id)
      },
      onEose: () => {
        complete = true
      },
    })
    await until(() => complete)
    expect(broad).toHaveLength(cap - 1)
    expect(broad).not.toContain(older.id)
    expect(broad).not.toContain(dm.id)
    expect(control.repository.query([{ids: [older.id]}])).toHaveLength(1)
    expect(control.repository.query([{ids: [dm.id]}])).toHaveLength(0)
    // The core's retained DB has already removed the deleted grant in that case;
    // its retained deletion and definition are both fetched below cap3.
    expect(view.access).toBe("ready")
    expect(view.events.map(event => event.id)).toEqual(evidence === "grant" ? [note.id] : [])
  },
  20000,
)
