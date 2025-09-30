import * as nip19 from "nostr-tools/nip19"
import {range, DAY, hexToBytes, bytesToHex} from "@welshman/lib"
import { getEventTags } from "@welshman/util"

export const nsecEncode = (secret: string) => nip19.nsecEncode(hexToBytes(secret))

export const nsecDecode = (nsec: string) => {
  const {type, data} = nip19.decode(nsec)

  if (type !== "nsec") throw new Error(`Invalid nsec: ${nsec}`)

  return bytesToHex(data)
}

export const day = (seconds: number) => Math.floor(seconds / DAY)

export const daysBetween = (start: number, end: number) => [...range(start, end, DAY)].map(day)


export const FREELANCE_JOB = 32767
  // GIT_REPOSITORY is mistakenly defined in welshman as 30403 which
  // is a Draft Classified listing (nip99) kind in reality.
export const GIT_REPO = 30617
export const GIT_REPO_STATE = 30618
export const GIT_REPO_BOOKMARK_DTAG = 'git-repo-bookmark'

export enum GitIssueStatus {
  OPEN = "Open",
  CLOSED = "Closed",
  RESOLVED = "Resolved",
  DRAFT = "Draft"
}

export const getRootEventTagValue = (tags: string[][]): string | undefined => {
  // Some people implement nip10 badly so the format
  //["e", <issue-id>, <relay-url>, <marker>, <pubkey>]
  // Becomes ["e", <issue-id>, <marker>]
  // When there is no relay hint it should be left there emtpy 
  // ["e", <issue-id, "", <marker>]
  return getEventTags(tags).find(
    t => t[3]==='root' || t[2] ==='root'
  )?.[1]
}

export const ucFirst = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1)
