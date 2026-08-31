import {PublishStatus} from "@welshman/net"

type PublicationResult = {
  relay?: string
  status?: unknown
  detail?: string
}

export type LinkedPublication = {
  complete: Promise<unknown>
  results: Record<string, PublicationResult>
}

const normalizeRelay = (relay: string) => relay.trim().replace(/\/+$/, "")

const successfulRelays = (publication: LinkedPublication) =>
  new Set(
    Object.entries(publication.results)
      .filter(([, result]) => result.status === PublishStatus.Success)
      .map(([relay, result]) => normalizeRelay(result.relay || relay)),
  )

export const awaitLinkedPublication = async (
  publications: [LinkedPublication, ...LinkedPublication[]],
): Promise<string[]> => {
  await Promise.all(publications.map(publication => publication.complete))

  const [first, ...rest] = publications.map(successfulRelays)
  const commonRelays = [...first].filter(relay => rest.every(relays => relays.has(relay)))
  if (commonRelays.length === 0) {
    throw new Error(
      "No relay accepted both the pull request and its open status. Retry publishing.",
    )
  }

  return commonRelays
}
