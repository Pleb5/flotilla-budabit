import {
  extractLabelEvents,
  mergeEffectiveLabels,
  type CoverLetterEvent,
  type IssueEvent,
  type LabelEvent,
} from "@nostr-git/core/events"

type WithTimeAndId = {
  id?: string
  created_at?: number
}

const sortByCreatedAtIdAsc = <T extends WithTimeAndId>(events: T[]) =>
  [...events].sort((a, b) => {
    const aTime = a.created_at ?? 0
    const bTime = b.created_at ?? 0
    if (aTime !== bTime) return aTime - bTime
    return (a.id || "").localeCompare(b.id || "")
  })

const getTagValue = (tags: string[][], name: string) => tags.find(tag => tag[0] === name)?.[1] || ""

const hasRootReference = (event: {tags?: string[][]}, rootId: string) =>
  (event.tags || []).some(tag => tag[0] === "e" && tag[1] === rootId)

const getIssueRootSubject = (issueEvent: IssueEvent) => {
  const subjectTag = getTagValue(issueEvent.tags || [], "subject")
  if (subjectTag) return subjectTag
  return issueEvent.content?.split("\n")?.[0] || ""
}

export type EffectiveIssueEdits = {
  subject: string
  content: string
  labels: string[]
  effectiveLabels: ReturnType<typeof mergeEffectiveLabels>
}

export const resolveIssueEdits = (args: {
  issueEvent: IssueEvent
  labelEvents?: LabelEvent[]
  coverLetters?: CoverLetterEvent[]
  maintainers?: Iterable<string>
}): EffectiveIssueEdits => {
  const {issueEvent, labelEvents = [], coverLetters = [], maintainers = []} = args

  const authoritativeEditors = new Set<string>([
    issueEvent.pubkey,
    ...Array.from(maintainers).filter(Boolean),
  ])

  const authoritativeLabels = labelEvents.filter(
    event => authoritativeEditors.has(event.pubkey) && hasRootReference(event, issueEvent.id),
  )

  const externalLabels = extractLabelEvents(authoritativeLabels)
  const effectiveLabels = mergeEffectiveLabels({
    self: [],
    external: externalLabels,
    t: (issueEvent.tags || [])
      .filter(tag => tag[0] === "t")
      .map(tag => tag[1])
      .filter(Boolean),
  })

  const labelValues = Array.from(
    new Set<string>([
      ...Array.from(effectiveLabels.byNamespace["#t"] || []),
      ...Array.from(effectiveLabels.byNamespace.ugc || []),
    ]),
  )

  let subject = getIssueRootSubject(issueEvent)
  const subjectUpdates = sortByCreatedAtIdAsc(
    externalLabels.filter(label => label.namespace === "#subject" && label.op !== "del"),
  )
  for (const update of subjectUpdates) {
    subject = update.value
  }

  let content = issueEvent.content || ""
  const authoritativeCoverLetters = sortByCreatedAtIdAsc(
    coverLetters.filter(
      event => authoritativeEditors.has(event.pubkey) && hasRootReference(event, issueEvent.id),
    ),
  )
  for (const cover of authoritativeCoverLetters) {
    content = cover.content || ""
  }

  return {
    subject,
    content,
    labels: labelValues,
    effectiveLabels,
  }
}
