// Run ONLY with the pre-migration package versions. All keys below are public test data.
import "fake-indexeddb/auto"
import {createRequire} from "node:module"
import {readFileSync, writeFileSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {secp256k1} from "@noble/curves/secp256k1"
import {mnemonicToSeedSync} from "@scure/bip39"

const require = createRequire(import.meta.url)
// Optional exact entrypoints allow regeneration with retained v1 packages.
const adapter = process.env.CASHU_V1_ADAPTER || "@cashu/coco-indexeddb"
const sdk = process.env.CASHU_V1_SDK || "@cashu/cashu-ts"
const {IndexedDbRepositories} = await import(adapter)
const {deriveKeysetId, deriveSecret, hashToCurve, OutputData} = await import(sdk)
const adapterPackage = JSON.parse(
  readFileSync(resolve(dirname(require.resolve(adapter)), "../package.json")),
)
if (adapterPackage.version !== "1.0.0") throw new Error("Capture requires Coco IndexedDB 1.0.0")
const sdkPackage = JSON.parse(
  readFileSync(resolve(dirname(require.resolve(sdk)), "../package.json")),
)
if (sdkPackage.version !== "3.3.0") throw new Error("Capture requires Cashu-TS 3.3.0")

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const seed = mnemonicToSeedSync(mnemonic)
const mintUrl = "https://cashu-fixture.invalid"
const time = 1780000000
const expiry = 4102444800
const keys = Object.fromEntries(
  [1, 2, 4, 8, 16].map((amount, i) => [
    amount,
    secp256k1.ProjectivePoint.BASE.multiply(BigInt(i + 1)).toHex(true),
  ]),
)
const ids = [deriveKeysetId(keys), deriveKeysetId(keys, {unit: "sat", versionByte: 1})]
const proof = (id, amount, counter, state = "ready", usedByOperationId) => {
  const secret = Buffer.from(deriveSecret(seed, id, counter)).toString("hex")
  const scalar = BigInt([1, 2, 4, 8, 16].indexOf(amount) + 1)
  return {
    id,
    amount,
    secret,
    C: hashToCurve(new TextEncoder().encode(secret)).multiply(scalar).toHex(true),
    mintUrl,
    state,
    ...(usedByOperationId ? {usedByOperationId} : {}),
  }
}
const proofs = [
  proof(ids[0], 2, 0),
  proof(ids[1], 4, 0),
  proof(ids[1], 2, 1, "inflight", "send-pending"),
  proof(ids[1], 8, 2, "inflight", "melt-pending"),
]
const outputData = (amount, counter) => ({
  send: [],
  keep: OutputData.createDeterministicData(amount, seed, counter, {id: ids[1], keys}).map(o => ({
    blindedMessage: o.blindedMessage,
    blindingFactor: o.blindingFactor.toString(16),
    secret: Buffer.from(o.secret).toString("hex"),
  })),
})
const repo = new IndexedDbRepositories({name: "capture-synthetic-cashu-v1"})
await repo.init()
await repo.mintRepository.addNewMint({
  mintUrl,
  name: "Synthetic migration mint",
  mintInfo: {name: "fixture", nuts: {}},
  trusted: true,
  createdAt: time,
  updatedAt: time,
})
for (const id of ids) {
  await repo.keysetRepository.addKeyset({
    mintUrl,
    id,
    unit: "sat",
    keypairs: keys,
    active: id === ids[1],
    feePpk: 0,
  })
  await repo.counterRepository.setCounter(mintUrl, id, id === ids[0] ? 1 : 8)
}
await repo.proofRepository.saveProofs(mintUrl, proofs)
const secretKey = Uint8Array.from({length: 32}, (_, i) => (i === 31 ? 7 : 0))
const publicKeyHex = secp256k1.ProjectivePoint.BASE.multiply(7n).toHex(true)
await repo.keyRingRepository.setPersistedKeyPair({publicKeyHex, secretKey, derivationIndex: 3})
await repo.mintQuoteRepository.addMintQuote({
  mintUrl,
  quote: "mint-unpaid",
  request: "lnbc-fixture-unpaid",
  state: "UNPAID",
  amount: 4,
  unit: "sat",
  expiry,
  pubkey: publicKeyHex,
})
await repo.meltQuoteRepository.addMeltQuote({
  mintUrl,
  quote: "melt-pending",
  request: "lnbc-fixture-melt",
  state: "PENDING",
  amount: 7,
  fee_reserve: 1,
  unit: "sat",
  expiry,
})
const token = {
  mint: mintUrl,
  unit: "sat",
  proofs: [{id: proofs[2].id, amount: proofs[2].amount, secret: proofs[2].secret, C: proofs[2].C}],
}
await repo.sendOperationRepository.create({
  id: "send-pending",
  mintUrl,
  amount: 2,
  method: "default",
  methodData: {},
  state: "pending",
  createdAt: time,
  updatedAt: time,
  needsSwap: false,
  fee: 0,
  inputAmount: 2,
  inputProofSecrets: [proofs[2].secret],
  token,
})
await repo.mintOperationRepository.create({
  id: "mint-pending",
  mintUrl,
  amount: 4,
  unit: "sat",
  method: "bolt11",
  methodData: {},
  state: "pending",
  quoteId: "mint-unpaid",
  request: "lnbc-fixture-unpaid",
  expiry,
  pubkey: publicKeyHex,
  lastObservedRemoteState: "UNPAID",
  outputData: outputData(4, 3),
  createdAt: time,
  updatedAt: time,
})
await repo.meltOperationRepository.create({
  id: "melt-pending",
  mintUrl,
  method: "bolt11",
  methodData: {},
  state: "pending",
  quoteId: "melt-pending",
  unit: "sat",
  amount: 7,
  fee_reserve: 1,
  swap_fee: 0,
  needsSwap: false,
  inputAmount: 8,
  inputProofSecrets: [proofs[3].secret],
  changeOutputData: outputData(1, 4),
  createdAt: time,
  updatedAt: time,
})
await repo.receiveOperationRepository.create({
  id: "receive-executing",
  mintUrl,
  amount: 2,
  unit: "sat",
  state: "executing",
  inputProofs: token.proofs,
  outputData: outputData(2, 5),
  fee: 0,
  createdAt: time,
  updatedAt: time,
})
await repo.historyRepository.addHistoryEntry({
  mintUrl,
  type: "send",
  amount: 2,
  operationId: "send-pending",
  token,
  state: "pending",
  createdAt: time,
})
await repo.historyRepository.addHistoryEntry({
  mintUrl,
  type: "mint",
  amount: 4,
  quoteId: "legacy-issued",
  state: "ISSUED",
  createdAt: time - 1,
})

const native = repo.db.backendDB()
const stores = []
for (const name of Array.from(native.objectStoreNames)) {
  const store = native.transaction(name).objectStore(name)
  const indexes = Array.from(store.indexNames, name => {
    const index = store.index(name)
    return {name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry}
  })
  const rows = await repo.db.table(name).toArray()
  // Clock-generated metadata is fixed so regeneration has a stable diff.
  for (const row of rows)
    for (const field of ["createdAt", "updatedAt"])
      if (field in row && row[field] > time) row[field] = time
  stores.push({name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, rows})
}
const fixture = {
  description:
    "PUBLIC SYNTHETIC TEST DATA. Captured using Coco IndexedDB 1.0.0 and Cashu-TS 3.3.0; never funded.",
  mnemonic,
  mintUrl,
  ids,
  version: native.version,
  stores,
}
writeFileSync(
  new URL("../tests/fixtures/cashu-v1-wallet.json", import.meta.url),
  JSON.stringify(fixture, null, 2) + "\n",
)
repo.db.close()
console.log(`Captured synthetic v1 wallet at native IDB version ${fixture.version}`)
