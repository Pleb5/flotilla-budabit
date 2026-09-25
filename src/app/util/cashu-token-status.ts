import type {CashuTokenStatus} from "@app/core/cashu-token-status"
import {formatCashuSats} from "./cashu-format"

export const cashuTokenPresentation = (status?: CashuTokenStatus) => {
  if (status?.received)
    return {
      label: "Received",
      tone: "success",
      help: `This token was added to this wallet on ${new Date(status.received.at).toLocaleString()}. You don't need to redeem it again.`,
    }
  if (status?.receiving)
    return {
      label: "Receipt unconfirmed",
      tone: "warning",
      help: "The last receive attempt hasn't been confirmed yet. Check the receipt to let the wallet finish with the mint.",
    }
  if (status?.outgoing?.state === "reclaimed")
    return {
      label: "Returned to wallet",
      tone: "neutral",
      help: "This token was returned to the sending wallet. It can no longer be redeemed.",
    }
  const checked = status?.check
    ? `\nLast checked: ${new Date(status.check.checkedAt).toLocaleString()}.`
    : ""
  if (status?.check?.state === "spent" || status?.outgoing?.state === "spent")
    return {
      label: "Redeemed",
      tone: "neutral",
      help: `The mint confirmed this token has been used. It can't be redeemed again. This doesn't tell us who redeemed it.${checked}`,
    }
  if (status?.check?.state === "partial")
    return {
      label: "Partly redeemed",
      tone: "warning",
      help: `${formatCashuSats(status.check.spent)} sats have been redeemed. ${formatCashuSats(status.check.unspent)} sats were still unredeemed${status.check.pending ? ` and ${formatCashuSats(status.check.pending)} sats were being processed` : ""} when checked. Ask the sender about the remaining amount.${checked}`,
    }
  if (status?.check?.state === "pending")
    return {
      label: "Processing at mint",
      tone: "warning",
      help: `The mint is processing this token. Check again shortly.${checked}`,
    }
  if (status?.check?.state === "unspent")
    return {
      label: "Not yet redeemed",
      tone: "neutral",
      help: `This token hadn't been redeemed when we last checked with the mint. Its status may have changed since then.${checked}`,
    }
  return {
    label: "Not checked",
    tone: "neutral",
    help: "Creating or sharing a token doesn't confirm it was redeemed. Check with the mint to find out. Checking won't redeem the token.",
  }
}
