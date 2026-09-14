import {verifyEvent, type TrustedEvent, type EventTemplate, type Filter} from "@welshman/util"
import {type AbstractAdapter} from "./adapter.js"
import {Repository} from "./repository.js"
import {Pool} from "./pool.js"

export type NetContext = {
  beforePublish?: (event: EventTemplate, relays: string[]) => void
  beforeRequest?: (filters: Filter[], relays: string[], isolated: boolean) => void | boolean
  pool: Pool
  repository: Repository
  isEventValid: (event: TrustedEvent, url: string) => boolean
  isEventDeleted: (event: TrustedEvent, url: string) => boolean
  getAdapter?: (url: string, context: NetContext) => AbstractAdapter
}

export const netContext: NetContext = {
  pool: Pool.get(),
  repository: Repository.get(),
  isEventValid: (event, url) => verifyEvent(event),
  isEventDeleted: (event, url) => netContext.repository.isDeleted(event),
}
