import type {Readable} from "svelte/store"
import type {FuseResult} from 'fuse.js'
import {get, writable, readable, derived} from "svelte/store"
import type {Maybe} from "@welshman/lib"
import {uniq, uniqBy, groupBy, pushToMapKey, nthEq, batcher, postJson, stripProtocol, assoc, indexBy, now} from "@welshman/lib"
import {getIdentifier, getRelayTags, getRelayTagValues, normalizeRelayUrl, getPubkeyTagValues, GROUP_META, PROFILE, RELAYS, FOLLOWS, MUTES, GROUPS, getGroupTags, readProfile, readList, asDecryptedEvent, editList, makeList, createList} from "@welshman/util"
import type {Filter, SignedEvent, CustomEvent, PublishedProfile, PublishedList} from '@welshman/util'
import type {SubscribeRequest, PublishRequest} from '@welshman/net'
import {publish as basePublish, subscribe} from '@welshman/net'
import {decrypt} from '@welshman/signer'
import {deriveEvents, deriveEventsMapped, getter, withGetter} from "@welshman/store"
import {parseJson, createSearch} from '@lib/util'
import type {Session, Handle, Relay} from '@app/types'
import {INDEXER_RELAYS, DUFFLEPUD_URL, repository, pk, getSession, getSigner, signer} from "@app/base"

// Utils

export const createCollection = <T>({
  name,
  store,
  getKey,
  load,
}: {
  name: string,
  store: Readable<T[]>,
  getKey: (item: T) => string,
  load: (key: string, ...args: any) => Promise<any>
}) => {
  const indexStore = derived(store, $items => indexBy(getKey, $items))
  const getIndex = getter(indexStore)
  const getItem = (key: string) => getIndex().get(key)
  const pending = new Map<string, Promise<Maybe<T>>>

  const loadItem = async (key: string, ...args: any[]) => {
    if (getFreshness(name, key) > now() - 3600) {
      return getIndex().get(key)
    }

    if (pending.has(key)) {
      await pending.get(key)
    } else {
      setFreshness(name, key, now())

      const promise = load(key, ...args)

      pending.set(key, promise)

      await promise

      pending.delete(key)
    }

    return getIndex().get(key)
  }

  const deriveItem = (key: Maybe<string>, ...args: any[]) => {
    if (!key) {
      return readable(undefined)
    }

    // If we don't yet have the item, or it's stale, trigger a request for it. The derived
    // store will update when it arrives
    load(key, ...args)

    return derived(indexStore, $index => $index.get(key))
  }

  return {indexStore, getIndex, deriveItem, loadItem, getItem}
}

export const publish = (request: PublishRequest) => {
  repository.publish(request.event)

  return basePublish(request)
}

export const load = (request: SubscribeRequest) =>
  new Promise<Maybe<CustomEvent>>(resolve => {
    const sub = subscribe({closeOnEose: true, timeout: 3000, delay: 50, ...request})

    sub.emitter.on('event', (url: string, e: SignedEvent) => {
      repository.publish(e)
      sub.close()
      resolve(e)
    })

    sub.emitter.on('complete', () => resolve(undefined))
  })

// Freshness

export const freshness = withGetter(writable<Record<string, number>>({}))

export const getFreshnessKey = (ns: string, key: string) => `${ns}:${key}`

export const getFreshness = (ns: string, key: string) => freshness.get()[getFreshnessKey(ns, key)] || 0

export const setFreshness = (ns: string, key: string, ts: number) => freshness.update(assoc(getFreshnessKey(ns, key), ts))

export const setFreshnessBulk = (ns: string, updates: Record<string, number>) =>
  freshness.update($freshness => {
    for (const [key, ts] of Object.entries(updates)) {
      $freshness[key] = ts
    }

    return $freshness
  })

// Plaintext

export const plaintext = withGetter(writable<Record<string, string>>({}))

export const getPlaintext = (e: CustomEvent) => plaintext.get()[e.id]

export const setPlaintext = (e: CustomEvent, content: string) =>
  plaintext.update(assoc(e.id, content))

export const ensurePlaintext = async (e: CustomEvent) => {
  if (e.content && !getPlaintext(e)) {
    const $signer = getSigner(getSession(e.pubkey))

    if ($signer) {
      setPlaintext(e, await decrypt($signer, e.pubkey, e.content))
    }
  }

  return getPlaintext(e)
}

// Relay info

export const relays = writable<Relay[]>([])

export const relaysByPubkey = derived(relays, $relays => groupBy(($relay: Relay) => $relay.pubkey, $relays))

export const {
  indexStore: relaysByUrl,
  getIndex: getRelaysByUrl,
  deriveItem: deriveRelay,
  loadItem: loadRelay,
} = createCollection({
  name: 'relays',
  store: relays,
  getKey: (relay: Relay) => relay.url,
  load: batcher(800, async (urls: string[]) => {
    const urlSet = new Set(urls)
    const res = await postJson(`${DUFFLEPUD_URL}/relay/info`, {urls: Array.from(urlSet)})
    const index = indexBy((item: any) => item.url, res?.data || [])
    const items: Relay[] = urls.map(url => {
      const {info = {}} = index.get(url) || {}

      return {...info, url}
    })

    relays.update($relays => uniqBy($relay => $relay.url, [...$relays, ...items]))

    return items
  }),
})

// Handles

export const handles = writable<Handle[]>([])

export const {
  indexStore: handlesByNip05,
  getIndex: getHandlesByNip05,
  deriveItem: deriveHandle,
  loadItem: loadHandle,
} = createCollection({
  name: 'handles',
  store: handles,
  getKey: (handle: Handle) => handle.nip05,
  load: batcher(800, async (nip05s: string[]) => {
    const nip05Set = new Set(nip05s)
    const res = await postJson(`${DUFFLEPUD_URL}/handle/info`, {handles: Array.from(nip05Set)})
    const index = indexBy((item: any) => item.handle, res?.data || [])
    const items: Handle[] = nip05s.map(nip05 => {
      const {info = {}} = index.get(nip05) || {}

      return {...info, nip05}
    })

    handles.update($handles => uniqBy($handle => $handle.nip05, [...$handles, ...items]))

    return items
  }),
})

// Profiles

export const profiles = deriveEventsMapped<PublishedProfile>(repository, {
  filters: [{kinds: [PROFILE]}],
  eventToItem: readProfile,
  itemToEvent: item => item.event,
})

export const {
  indexStore: profilesByPubkey,
  getIndex: getProfilesByPubkey,
  deriveItem: deriveProfile,
  loadItem: loadProfile,
} = createCollection({
  name: 'profiles',
  store: profiles,
  getKey: profile => profile.event.pubkey,
  load: (pubkey: string, relays = [], request: Partial<SubscribeRequest> = {}) =>
    load({
      ...request,
      relays: [...relays, ...INDEXER_RELAYS],
      filters: [{kinds: [PROFILE], authors: [pubkey]}],
    }),
})

// Relay selections

export const getReadRelayUrls = (event?: CustomEvent): string[] =>
  getRelayTags(event?.tags || []).filter((t: string[]) => !t[2] || t[2] === 'read').map((t: string[]) => normalizeRelayUrl(t[1]))

export const getWriteRelayUrls = (event?: CustomEvent): string[] =>
  getRelayTags(event?.tags || []).filter((t: string[]) => !t[2] || t[2] === 'write').map((t: string[]) => normalizeRelayUrl(t[1]))

export const relaySelections = deriveEvents(repository, {filters: [{kinds: [RELAYS]}]})

export const {
  indexStore: relaySelectionsByPubkey,
  getIndex: getRelaySelectionsByPubkey,
  deriveItem: deriveRelaySelections,
  loadItem: loadRelaySelections,
} = createCollection({
  name: 'relaySelections',
  store: relaySelections,
  getKey: relaySelections => relaySelections.pubkey,
  load: (pubkey: string, relays = [], request: Partial<SubscribeRequest> = {}) =>
    load({
      ...request,
      relays: [...relays, ...INDEXER_RELAYS],
      filters: [{kinds: [RELAYS], authors: [pubkey]}],
    })
})

// Follows

export const follows = deriveEventsMapped<PublishedList>(repository, {
  filters: [{kinds: [FOLLOWS]}],
  itemToEvent: item => item.event,
  eventToItem: async (event: CustomEvent) =>
    readList(
      asDecryptedEvent(event, {
        content: await ensurePlaintext(event),
      }),
    ),
})

export const {
  indexStore: followsByPubkey,
  getIndex: getFollowsByPubkey,
  deriveItem: deriveFollows,
  loadItem: loadFollows,
} = createCollection({
  name: 'follows',
  store: follows,
  getKey: follows => follows.event.pubkey,
  load: (pubkey: string, relays = [], request: Partial<SubscribeRequest> = {}) =>
    load({
      ...request,
      relays: [...relays, ...INDEXER_RELAYS],
      filters: [{kinds: [FOLLOWS], authors: [pubkey]}],
    })
})

// Mutes

export const mutes = deriveEventsMapped<PublishedList>(repository, {
  filters: [{kinds: [MUTES]}],
  itemToEvent: item => item.event,
  eventToItem: async (event: CustomEvent) =>
    readList(
      asDecryptedEvent(event, {
        content: await ensurePlaintext(event),
      }),
    ),
})

export const {
  indexStore: mutesByPubkey,
  getIndex: getMutesByPubkey,
  deriveItem: deriveMutes,
  loadItem: loadMutes,
} = createCollection({
  name: 'mutes',
  store: mutes,
  getKey: mute => mute.event.pubkey,
  load: (pubkey: string, relays = [], request: Partial<SubscribeRequest> = {}) =>
    load({
      ...request,
      relays: [...relays, ...INDEXER_RELAYS],
      filters: [{kinds: [MUTES], authors: [pubkey]}],
    })
})

// Groups

export const GROUP_DELIMITER = `'`

export const makeGroupId = (url: string, nom: string) =>
  [stripProtocol(url).replace(/\/$/, ''), nom].join(GROUP_DELIMITER)

export const splitGroupId = (groupId: string) => {
  const [url, nom] = groupId.split(GROUP_DELIMITER)

  return [normalizeRelayUrl(url), nom]
}

export const getGroupUrl = (groupId: string) => splitGroupId(groupId)[0]

export const getGroupNom = (groupId: string) => splitGroupId(groupId)[1]

export const getGroupName = (e?: CustomEvent) => e?.tags.find(nthEq(0, "name"))?.[1]

export const getGroupPicture = (e?: CustomEvent) => e?.tags.find(nthEq(0, "picture"))?.[1]

export type Group = {
  nom: string,
  name?: string,
  about?: string,
  picture?: string,
  event?: CustomEvent
}

export type PublishedGroup = Omit<Group, "event"> & {
  event: CustomEvent
}

export const readGroup = (event: CustomEvent) => {
  const nom = getIdentifier(event)!
  const name = event?.tags.find(nthEq(0, "name"))?.[1] || "[no name]"
  const about = event?.tags.find(nthEq(0, "about"))?.[1] || ""
  const picture = event?.tags.find(nthEq(0, "picture"))?.[1]

  return {nom, name, about, picture, event}
}

export const groups = deriveEventsMapped<PublishedGroup>(repository, {
  filters: [{kinds: [GROUP_META]}],
  eventToItem: readGroup,
  itemToEvent: item => item.event,
})

export const {
  indexStore: groupsByNom,
  getIndex: getGroupsByNom,
  deriveItem: deriveGroup,
  loadItem: loadGroup,
} = createCollection({
  name: 'groups',
  store: groups,
  getKey: (group: PublishedGroup) => group.nom,
  load: (nom: string, relays: string[] = [], request: Partial<SubscribeRequest> = {}) =>
    Promise.all([
      ...relays.map(loadRelay),
      load({
        ...request,
        relays,
        filters: [{kinds: [GROUP_META], '#d': [nom]}],
      }),
    ])
})

export const searchGroups = derived(
  groups,
  $groups =>
    createSearch($groups, {
      getValue: (group: PublishedGroup) => group.nom,
      sortFn: (result: FuseResult<PublishedGroup>) => {
        const scale = result.item.picture ? 0.5 : 1

        return result.score! * scale
      },
      fuseOptions: {
        keys: ["name", {name: "about", weight: 0.3}],
      },
    })
)

// Qualified groups

export type QualifiedGroup = {
  id: string
  relay: Relay
  group: PublishedGroup
}

export const qualifiedGroups = derived([relaysByPubkey, groups], ([$relaysByPubkey, $groups]) =>
  $groups.flatMap((group: PublishedGroup) => {
    const relays = $relaysByPubkey.get(group.event.pubkey) || []

    return relays.map(relay => ({id: makeGroupId(relay.url, group.nom), relay, group}))
  })
)

export const qualifiedGroupsById = derived(qualifiedGroups, $qualifiedGroups => indexBy($qg => $qg.id, $qualifiedGroups))

export const qualifiedGroupsByNom = derived(qualifiedGroups, $qualifiedGroups => groupBy($qg => $qg.group.nom, $qualifiedGroups))

export const relayUrlsByNom = derived(qualifiedGroups, $qualifiedGroups => {
  const $relayUrlsByNom = new Map()

  for (const {relay, group} of $qualifiedGroups) {
    pushToMapKey($relayUrlsByNom, group.nom, relay.url)
  }

  return $relayUrlsByNom
})

// Group membership

export type GroupMembership = {
  ids: Set<string>
  noms: Set<string>
  urls: Set<string>
  event?: CustomEvent
}

export type PublishedGroupMembership = Omit<GroupMembership, "event"> & {
  event: CustomEvent
}

export const readGroupMembership = (event: CustomEvent) => {
  const ids = new Set<string>()
  const noms = new Set<string>()
  const urls = new Set<string>()

  for (const [_, nom, url] of getGroupTags(event.tags)) {
    ids.add(makeGroupId(url, nom))
    noms.add(nom)
    urls.add(url)
  }

  return {event, ids, noms, urls}
}

export const groupMemberships = deriveEventsMapped<PublishedGroupMembership>(repository, {
  filters: [{kinds: [GROUPS]}],
  eventToItem: readGroupMembership,
  itemToEvent: item => item.event,
})

export const {
  indexStore: groupMembershipByPubkey,
  getIndex: getGroupMembersipByPubkey,
  deriveItem: deriveGroupMembership,
  loadItem: loadGroupMembership,
} = createCollection({
  name: 'groupMemberships',
  store: groupMemberships,
  getKey: groupMembership => groupMembership.event.pubkey,
  load: (pubkey: string, relays = [], request: Partial<SubscribeRequest> = {}) =>
    load({
      ...request,
      relays: [...relays, ...INDEXER_RELAYS],
      filters: [{kinds: [GROUPS], authors: [pubkey]}],
    })
})

// Group Messages

export type GroupMessage = {
  nom: string
  event: CustomEvent
}

export const readGroupMessage = (event: CustomEvent): Maybe<GroupMessage> => {
  const nom = event.tags.find(nthEq(0, 'h'))?.[1]

  if (!nom) {
    return undefined
  }

  return {nom, event}
}

export const groupMessages = deriveEventsMapped<GroupMessage>(repository, {
  filters: [{}],
  eventToItem: readGroupMessage,
  itemToEvent: item => item.event,
})

// Group Conversations

export type GroupConversation = {
  nom: string
  messages: GroupMessage[]
}

export const groupConversations = derived(groupMessages, $groupMessages => {
  const groupMessagesByNom = groupBy($groupMessage => $groupMessage.nom, $groupMessages)

  return Array.from(groupMessagesByNom.entries()).map(([nom, messages]) => ({nom, messages}))
})

export const {
  indexStore: groupConversationByNom,
  getIndex: getGroupMembersipByNom,
  deriveItem: deriveGroupConversation,
  loadItem: loadGroupConversation,
} = createCollection({
  name: 'groupConversations',
  store: groupConversations,
  getKey: groupConversation => groupConversation.nom,
  load: (nom: string, hints = [], request: Partial<SubscribeRequest> = {}) => {
    const relays = [...hints, ...get(relayUrlsByNom).get(nom) || []]

    if (relays.length === 0) {
      console.warn(`Attempted to load conversation for ${nom} with no qualified groups`)
    }

    return load({...request, relays, filters: [{'#h': [nom]}]})
  },
})

// User stuff

export const userProfile = derived([pk, profilesByPubkey], ([$pk, $profilesByPubkey]) => {
  if (!$pk) return null

  loadProfile($pk)

  return $profilesByPubkey.get($pk)
})

export const userMembership = derived([pk, groupMembershipByPubkey], ([$pk, $groupMembershipByPubkey]) => {
  if (!$pk) return null

  loadGroupMembership($pk)

  return $groupMembershipByPubkey.get($pk)
})

export const userGroupsByNom = withGetter(derived([userMembership, qualifiedGroupsById], ([$userMembership, $qualifiedGroupsById]) => {
  const $userGroupsByNom = new Map()

  for (const id of $userMembership?.ids || []) {
    const [url, nom] = splitGroupId(id)
    const group = $qualifiedGroupsById.get(id)
    const groups = $userGroupsByNom.get(nom) || []

    loadGroup(nom, [url])

    if (group) {
      groups.push(group)
    }

    $userGroupsByNom.set(nom, groups)
  }

  return $userGroupsByNom
}))
