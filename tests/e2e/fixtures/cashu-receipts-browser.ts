import {get} from "svelte/store"
import {
  addCashuMint,
  cashuTotalBalance,
  confirmCashuBackup,
  createCashuToken,
  createCashuWallet,
  mintTokensFromQuote,
  requestMintQuote,
  receiveCashuToken,
  reloadCashuWallet,
} from "../../../src/app/core/cashu"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {clearCashuTokenChecks} from "../../../src/app/core/cashu-status-cache"
import {getDebugDiagnosticsSnapshot} from "../../../src/app/core/debug-diagnostics"
import CashuTokenRedeemFlow from "../../../src/app/components/CashuTokenRedeemFlow.svelte"
import {pushModal} from "../../../src/app/util/modal"

const fixtureMint = "https://cashu-test.invalid"
const guard = () => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
}

export async function prepareSender() {
  guard()
  await createCashuWallet()
  await addCashuMint(fixtureMint)
  await confirmCashuBackup()
  const quotes = await Promise.all([
    requestMintQuote(fixtureMint, 128),
    requestMintQuote(fixtureMint, 128),
  ])
  return quotes.map(quote => quote.quote)
}
export async function fundSender(quotes: string[]) {
  guard()
  for (const quote of quotes) await mintTokensFromQuote(fixtureMint, quote, 128)
}
export async function fundAndSend(quotes: string[]) {
  await fundSender(quotes)
  return createCashuToken(210, fixtureMint)
}
export async function sendBack() {
  guard()
  return createCashuToken(20, fixtureMint)
}
export function balance() {
  guard()
  return get(cashuTotalBalance)
}
export function openReceive(token: string) {
  guard()
  pushModal(CashuTokenRedeemFlow, {token})
}

export async function receiveAndLoseIndex(token: string) {
  guard()
  await receiveCashuToken(token)
  const repo = new IndexedDbRepositories({name: "budabit-coco-wallet"})
  await repo.init()
  try {
    const table = repo.db.table("coco_cashu_receive_operations")
    const receipt = await table.toCollection().first()
    await table.delete(receipt.id)
    await table.bulkAdd([
      {...receipt, id: "zz-cold-receipt"},
      ...Array.from({length: 1005}, (_, i) => ({
        ...receipt,
        id: `public-history-${String(i).padStart(5, "0")}`,
        inputProofsJson: JSON.stringify(
          JSON.parse(receipt.inputProofsJson).map((proof: object) => ({
            ...proof,
            secret: `public-fixture-${i}`,
          })),
        ),
      })),
    ])
  } finally {
    repo.db.close()
  }
  await clearCashuTokenChecks()
  await reloadCashuWallet()
}

export function walletDiagnostics() {
  guard()
  return getDebugDiagnosticsSnapshot().records.filter(record => record.category === "cashu-wallet")
}
