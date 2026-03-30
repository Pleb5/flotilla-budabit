import {registerBridgeHandler} from "@app/extensions/bridge"
import {pushModal} from "@app/util/modal"
import {
  cashuTotalBalance,
  cashuBalancesByMint,
  cashuMints,
  cashuAutoPayWhitelist,
  receiveCashuToken,
  createCashuToken,
} from "@lib/budabit/cashu"
import type {Component} from "svelte"
import {get} from "svelte/store"

let bridgeHandlersRegistered = false

/**
 * Register cashu:* bridge handlers.
 * @param CashuPayConfirm - The CashuPayConfirm Svelte component (passed from a .svelte caller
 *   to avoid importing .svelte files from .ts files).
 */
export const registerCashuBridgeHandlers = (CashuPayConfirm: Component<any>) => {
  if (bridgeHandlersRegistered) return
  bridgeHandlersRegistered = true

  registerBridgeHandler("cashu:getBalance", (_payload, ext) => {
    if (ext) console.log(`[bridge] cashu:getBalance from ${ext.id}`)
    const total = get(cashuTotalBalance)
    const byMintMap = get(cashuBalancesByMint)
    const byMint: Record<string, number> = {}
    byMintMap.forEach((v, k) => {
      byMint[k] = v
    })
    return {total, byMint}
  })

  registerBridgeHandler("cashu:getMints", (_payload, ext) => {
    if (ext) console.log(`[bridge] cashu:getMints from ${ext.id}`)
    return get(cashuMints)
  })

  registerBridgeHandler("cashu:receiveToken", async (payload, ext) => {
    if (ext) console.log(`[bridge] cashu:receiveToken from ${ext.id}`)
    try {
      const {token} = payload || {}
      if (typeof token !== "string" || !token) throw new Error("Invalid token")
      const amount = await receiveCashuToken(token)
      return {status: "ok", amount}
    } catch (e: any) {
      return {error: e.message}
    }
  })

  registerBridgeHandler("cashu:createToken", async (payload, ext) => {
    if (ext) console.log(`[bridge] cashu:createToken from ${ext.id}`)
    try {
      const {amount, mintUrl, label} = payload || {}
      if (typeof amount !== "number" || amount <= 0) throw new Error("Invalid amount")
      if (typeof mintUrl !== "string" || !mintUrl) throw new Error("Invalid mintUrl")

      const extensionId = ext?.id || "unknown"
      const whitelist = get(cashuAutoPayWhitelist)

      if (whitelist.includes(extensionId)) {
        // Auto-approved
        const token = await createCashuToken(amount, mintUrl, label || extensionId)
        return {token}
      }

      // Show confirmation modal
      return new Promise(resolve => {
        pushModal(CashuPayConfirm, {
          amount,
          mintUrl,
          label: label || extensionId,
          extensionId,
          onresult: (result: {token: string} | {error: string}) => resolve(result),
        })
      })
    } catch (e: any) {
      return {error: e.message}
    }
  })
}
