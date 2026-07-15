const relayUrl = process.env.BUDABIT_PUBLIC_RELAY || "wss://relay.budabit.club/"
const infoUrl = relayUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:")
const timeoutMs = 15_000
const managedSubscriptions = 28
const filtersPerSubscription = 10
const secondWaveSubscriptions = 4
const maxMessageBytes = 128 * 1024

const withTimeout = (promise, label) => {
  let timer

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

const response = await withTimeout(
  fetch(infoUrl, {headers: {Accept: "application/nostr+json"}}),
  "NIP-11 request",
)
if (!response.ok) throw new Error(`NIP-11 request failed with ${response.status}`)

const profile = await response.json()
const expectedLimitations = {
  max_limit: 200,
  max_message_length: maxMessageBytes,
  max_subscriptions: 30,
}
for (const [name, expected] of Object.entries(expectedLimitations)) {
  const actual = profile.limitation?.[name]
  if (actual !== expected)
    throw new Error(`Expected limitation.${name}=${expected}, received ${actual}`)
}
if (profile.supported_nips?.includes(42)) {
  throw new Error("Public relay unexpectedly advertises NIP-42")
}

const socket = new WebSocket(relayUrl)
const eose = new Set()
const serverAuth = []
const notices = []
const closed = []
const waiters = new Set()

const notifyWaiters = () => {
  for (const waiter of waiters) waiter()
}

socket.addEventListener("message", event => {
  let message
  try {
    message = JSON.parse(String(event.data))
  } catch {
    return
  }

  if (message[0] === "EOSE") eose.add(message[1])
  if (message[0] === "AUTH") serverAuth.push(message)
  if (message[0] === "NOTICE") notices.push(message)
  if (message[0] === "CLOSED") closed.push(message)
  notifyWaiters()
})

await withTimeout(
  new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once: true})
    socket.addEventListener("error", () => reject(new Error(`Could not connect to ${relayUrl}`)), {
      once: true,
    })
  }),
  "WebSocket connection",
)

const waitForEose = ids =>
  withTimeout(
    new Promise(resolve => {
      const check = () => {
        if (ids.every(id => eose.has(id))) {
          waiters.delete(check)
          resolve()
        }
      }
      waiters.add(check)
      check()
    }),
    `EOSE for ${ids.length} subscriptions`,
  )

let idCounter = 0
let maxActive = 0
const active = new Set()
const makeFilterId = () => (++idCounter).toString(16).padStart(64, "0")
const sendReq = id => {
  const filters = Array.from({length: filtersPerSubscription}, () => ({
    ids: [makeFilterId()],
    limit: 1,
  }))
  const message = ["REQ", id, ...filters]
  const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength

  if (filters.length > filtersPerSubscription) throw new Error("Probe exceeded filter policy")
  if (bytes > maxMessageBytes) throw new Error(`Probe REQ is ${bytes} bytes`)

  active.add(id)
  maxActive = Math.max(maxActive, active.size)
  if (active.size > managedSubscriptions) throw new Error("Probe exceeded managed ID policy")
  socket.send(JSON.stringify(message))
}
const sendClose = id => {
  if (!active.delete(id)) return
  socket.send(JSON.stringify(["CLOSE", id]))
}

try {
  const firstWave = Array.from({length: managedSubscriptions}, (_, index) => `probe-1-${index}`)
  firstWave.forEach(sendReq)
  await waitForEose(firstWave)

  const released = firstWave.slice(0, secondWaveSubscriptions)
  released.forEach(sendClose)
  const secondWave = Array.from({length: secondWaveSubscriptions}, (_, index) => `probe-2-${index}`)
  secondWave.forEach(sendReq)
  await waitForEose(secondWave)

  if (serverAuth.length) throw new Error(`Relay sent AUTH: ${JSON.stringify(serverAuth[0])}`)
  if (notices.length) throw new Error(`Relay sent NOTICE: ${JSON.stringify(notices[0])}`)
  if (closed.length) throw new Error(`Relay rejected REQ: ${JSON.stringify(closed[0])}`)

  console.log(
    JSON.stringify(
      {
        relay: relayUrl,
        nip11: expectedLimitations,
        filtersPerSubscription,
        requestsCompleted: managedSubscriptions + secondWaveSubscriptions,
        maxActiveSubscriptions: maxActive,
        authMessages: serverAuth.length,
        notices: notices.length,
        closed: closed.length,
      },
      null,
      2,
    ),
  )
} finally {
  Array.from(active).forEach(sendClose)
  socket.close()
}
