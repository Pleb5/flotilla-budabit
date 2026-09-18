import {Amount, type AmountLike} from "@cashu/cashu-ts"

// App UI and extension messages currently use numeric sats. These are checked
// boundaries; wallet operations and persisted values retain the SDK's Amount.
export const cashuSatsNumber = (amount: AmountLike): number => Amount.from(amount).toNumber()

export const cashuPositiveSats = (amount: number): Amount => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive safe integer in sats")
  }
  return Amount.from(amount)
}
