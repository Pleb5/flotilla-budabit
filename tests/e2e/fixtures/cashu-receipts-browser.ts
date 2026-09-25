import {get} from "svelte/store"
import {
  addCashuMint,
  cashuTotalBalance,
  confirmCashuBackup,
  createCashuToken,
  createCashuWallet,
  mintTokensFromQuote,
  requestMintQuote,
} from "../../../src/app/core/cashu"
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
export async function fundAndSend(quotes: string[]) {
  guard()
  for (const quote of quotes) await mintTokensFromQuote(fixtureMint, quote, 128)
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
