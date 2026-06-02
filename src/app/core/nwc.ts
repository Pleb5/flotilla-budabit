import {nwc} from "@getalby/sdk"
import type {NWCInfo} from "@welshman/util"

export const PREFERRED_NWC_ENCRYPTION = "nip44_v2"
export const FALLBACK_NWC_ENCRYPTION = "nip04"

type NwcClient = InstanceType<typeof nwc.NWCClient>
type NwcClientOptions = NWCInfo | {nostrWalletConnectUrl: string}
type NwcPayInvoiceRequest = Parameters<NwcClient["payInvoice"]>[0]

export class NwcUnsupportedEncryptionError extends Error {
  constructor(encryptions: string[]) {
    const supported = encryptions.length > 0 ? encryptions.join(", ") : "none advertised"

    super(
      `Your wallet service does not advertise a supported NWC encryption scheme. It advertised: ${supported}.`,
    )
    this.name = "NwcUnsupportedEncryptionError"
  }
}

export const createNwcClient = (options: NwcClientOptions) =>
  new nwc.NWCClient(options as ConstructorParameters<typeof nwc.NWCClient>[0])

const chooseNwcEncryption = (encryptions: string[]) => {
  if (encryptions.includes(PREFERRED_NWC_ENCRYPTION)) return PREFERRED_NWC_ENCRYPTION
  if (encryptions.includes(FALLBACK_NWC_ENCRYPTION)) return FALLBACK_NWC_ENCRYPTION

  return ""
}

export const getNwcWalletServiceInfo = async (client: NwcClient) => {
  const serviceInfo = await client.getWalletServiceInfo()
  const encryptions = serviceInfo.encryptions || []
  const encryptionType = chooseNwcEncryption(encryptions)

  if (!encryptionType) {
    throw new NwcUnsupportedEncryptionError(encryptions)
  }

  return {...serviceInfo, encryptionType}
}

const getSelectedEncryptionType = (client: NwcClient) => {
  try {
    return client.encryptionType
  } catch {
    return ""
  }
}

const getPersistedNwcInfo = (client: NwcClient, fallbackEncryptionType = PREFERRED_NWC_ENCRYPTION) => ({
  ...client.options,
  nostrWalletConnectUrl: client.nostrWalletConnectUrl,
  encryptionType: getSelectedEncryptionType(client) || fallbackEncryptionType,
})

export const connectNwcWallet = async (nostrWalletConnectUrl: string) => {
  const client = createNwcClient({nostrWalletConnectUrl})

  try {
    const serviceInfo = await getNwcWalletServiceInfo(client)
    const info = await client.getInfo()

    return {
      info,
      serviceInfo,
      walletInfo: getPersistedNwcInfo(client, serviceInfo.encryptionType) as NWCInfo,
    }
  } finally {
    client.close()
  }
}

export const getNwcBalance = async (options: NwcClientOptions) => {
  const client = createNwcClient(options)

  try {
    await getNwcWalletServiceInfo(client)
    return await client.getBalance()
  } finally {
    client.close()
  }
}

export const payNwcInvoice = async (options: NwcClientOptions, request: NwcPayInvoiceRequest) => {
  const client = createNwcClient(options)

  try {
    await getNwcWalletServiceInfo(client)
    return await client.payInvoice(request)
  } finally {
    client.close()
  }
}

export const getNwcErrorMessage = (error: unknown, fallback = "Wallet request failed") =>
  error instanceof Error ? error.message : fallback
