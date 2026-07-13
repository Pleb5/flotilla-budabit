import type {Page} from "@playwright/test"

export const DEV_PUBKEY = "4646ae5047316b4230d0086c8acec687f00b1cd9d1dc634f6cb358ac0a9a8fff"
const DEV_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

export const seedDevSession = (page: Page) =>
  page.addInitScript(
    ({pubkey, secret}) => {
      localStorage.setItem("pubkey", JSON.stringify(pubkey))
      localStorage.setItem(
        "sessions",
        JSON.stringify({[pubkey]: {method: "nip01", secret, pubkey}}),
      )
    },
    {pubkey: DEV_PUBKEY, secret: DEV_SECRET},
  )
