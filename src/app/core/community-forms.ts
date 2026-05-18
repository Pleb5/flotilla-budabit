import {DELETE, type EventContent, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  normalizeCommunitySectionName,
  normalizePubkey,
  normalizeRelay,
  normalizeRelays,
} from "@app/core/community"

export const COMMUNITY_FORM_REVIEW_KIND = 7

export type CommunityFormOption = {
  id: string
  label: string
  settings: Record<string, unknown>
}

export type CommunityFormField = {
  id: string
  type: string
  label: string
  options: CommunityFormOption[]
  settings: Record<string, unknown>
}

export type CommunityFormFieldInput = {
  id: string
  type?: string
  label: string
  options?: Array<Pick<CommunityFormOption, "id" | "label"> & {settings?: Record<string, unknown>}>
  settings?: Record<string, unknown>
}

export type CommunityAdmissionQuestionType =
  | "shortAnswer"
  | "paragraph"
  | "singleChoice"
  | "multipleChoice"

export type CommunityAdmissionFormDraftOption = {
  id: string
  label: string
  isOther?: boolean
}

export type CommunityAdmissionFormDraftQuestion = {
  id: string
  type: CommunityAdmissionQuestionType
  label: string
  required: boolean
  options: CommunityAdmissionFormDraftOption[]
}

export type CommunityAdmissionFormDraft = {
  sectionName: string
  identifier: string
  name: string
  description: string
  questions: CommunityAdmissionFormDraftQuestion[]
}

export type CommunityAdmissionForm = {
  event: TrustedEvent
  address: string
  pubkey: string
  identifier: string
  name: string
  settings: Record<string, unknown>
  description?: string
  relays: string[]
  communityAddress?: string
  communityPubkey?: string
  sectionName?: string
  fields: Record<string, CommunityFormField>
  fieldOrder: string[]
}

export type CommunityFormResponseValue = {
  fieldId: string
  value: string
  metadata: Record<string, unknown>
}

export type CommunityFormResponse = {
  event: TrustedEvent
  formAddress: string
  values: Record<string, string>
  responses: CommunityFormResponseValue[]
}

export type CommunityFormReviewStatus = "granted" | "rejected"

export type CommunityFormReview = {
  event: TrustedEvent
  responseId: string
  applicantPubkey?: string
  status: CommunityFormReviewStatus
}

export type CommunitySubmissionStatus = "none" | "pending" | "granted" | "rejected"

export type CommunitySubmissionState = {
  status: CommunitySubmissionStatus
  response?: CommunityFormResponse
  review?: CommunityFormReview
}

const emptySettings = {} as Record<string, unknown>

const safeJsonObject = (value: string | undefined): Record<string, unknown> => {
  if (!value) return emptySettings

  try {
    const parsed = JSON.parse(value)

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : emptySettings
  } catch {
    return emptySettings
  }
}

const safeJsonArray = (value: string | undefined): unknown[] => {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const getDTag = (event: TrustedEvent) => event.tags.find(tag => tag[0] === "d")?.[1] || ""

const getEventAddress = (event: TrustedEvent) => {
  const identifier = getDTag(event)

  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

export const makeCommunityDefinitionAddress = (communityPubkey: string) => {
  const pubkey = normalizePubkey(communityPubkey)

  return pubkey ? `${COMMUNITY_DEFINITION_KIND}:${pubkey}:` : ""
}

export const parseCommunityDefinitionAddress = (address: string) => {
  const [kindValue, pubkeyValue, ...identifierParts] = address.split(":")
  const kind = Number.parseInt(kindValue || "", 10)
  const pubkey = normalizePubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")

  if (kind !== COMMUNITY_DEFINITION_KIND || !pubkey || identifier) return undefined

  return {kind, pubkey, address: `${COMMUNITY_DEFINITION_KIND}:${pubkey}:`}
}

export const makeAdmissionFormAddress = (pubkey: string, identifier: string) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  const normalizedIdentifier = identifier.trim()

  return normalizedPubkey && normalizedIdentifier
    ? `${FORM_TEMPLATE_KIND}:${normalizedPubkey}:${normalizedIdentifier}`
    : ""
}

const stringifySettings = (settings?: Record<string, unknown>) => JSON.stringify(settings || {})

const slugify = (value: string, fallback: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback

export const makeAdmissionFormIdentifier = ({
  communityPubkey,
  sectionName,
}: {
  communityPubkey: string
  sectionName: string
}) => {
  const communityPrefix = normalizePubkey(communityPubkey)?.slice(0, 12) || "community"

  return `community-${communityPrefix}-${slugify(normalizeCommunitySectionName(sectionName), "section")}-application`
}

export const makeDefaultAdmissionFormDraft = ({
  communityPubkey,
  sectionName,
}: {
  communityPubkey: string
  sectionName: string
}): CommunityAdmissionFormDraft => ({
  sectionName,
  identifier: makeAdmissionFormIdentifier({communityPubkey, sectionName}),
  name: `${sectionName} application`,
  description: `Request access to publish in the ${sectionName} section.`,
  questions: [
    {
      id: "q1",
      type: "paragraph",
      label: `Describe your application to publish in ${sectionName}`,
      required: true,
      options: [],
    },
  ],
})

const getDraftQuestionType = (field: CommunityFormField): CommunityAdmissionQuestionType => {
  const renderElement =
    typeof field.settings.renderElement === "string" ? field.settings.renderElement : undefined

  if (field.type === "option")
    return renderElement === "multipleChoice" ? "multipleChoice" : "singleChoice"
  if (renderElement === "paragraph") return "paragraph"

  return "shortAnswer"
}

export const makeAdmissionFormDraftFromForm = ({
  form,
  communityPubkey,
  sectionName,
  currentModeratorPubkey,
}: {
  form?: CommunityAdmissionForm
  communityPubkey: string
  sectionName: string
  currentModeratorPubkey?: string
}): CommunityAdmissionFormDraft => {
  if (!form) return makeDefaultAdmissionFormDraft({communityPubkey, sectionName})

  const currentModerator = normalizePubkey(currentModeratorPubkey || "")
  const identifier =
    currentModerator && form.pubkey === currentModerator
      ? form.identifier
      : makeAdmissionFormIdentifier({communityPubkey, sectionName})

  return {
    sectionName,
    identifier,
    name: form.name || `${sectionName} application`,
    description: form.description || `Request access to publish in the ${sectionName} section.`,
    questions: form.fieldOrder
      .map((fieldId, index) => {
        const field = form.fields[fieldId]
        if (!field || field.type === "label") return undefined

        return {
          id: field.id || `q${index + 1}`,
          type: getDraftQuestionType(field),
          label: field.label,
          required: field.settings.required !== false,
          options: field.options.map(option => ({
            id: option.id,
            label: option.label,
            isOther: option.settings.isOther === true,
          })),
        } satisfies CommunityAdmissionFormDraftQuestion
      })
      .filter(Boolean) as CommunityAdmissionFormDraftQuestion[],
  }
}

export const makeAdmissionFormFieldsFromDraft = (
  draft: CommunityAdmissionFormDraft,
): CommunityFormFieldInput[] =>
  draft.questions.map((question, index) => {
    const id = question.id.trim() || `q${index + 1}`
    const required = question.required

    if (question.type === "singleChoice" || question.type === "multipleChoice") {
      return {
        id,
        type: "option",
        label: question.label,
        options: question.options.map((option, optionIndex) => ({
          id: option.id.trim() || `option-${optionIndex + 1}`,
          label: option.label,
          settings: option.isOther ? {isOther: true} : {},
        })),
        settings: {required, renderElement: question.type},
      }
    }

    return {
      id,
      type: "text",
      label: question.label,
      settings: {required, renderElement: question.type},
    }
  })

export const validateAdmissionFormDraft = (draft: CommunityAdmissionFormDraft) => {
  const errors: string[] = []

  if (!draft.identifier.trim()) errors.push("Form identifier is missing.")
  if (!draft.name.trim()) errors.push("Form name is missing.")
  if (!draft.description.trim()) errors.push("Form description is missing.")
  if (draft.questions.length === 0) errors.push("Add at least one question.")

  for (const [index, question] of draft.questions.entries()) {
    const questionLabel = `Question ${index + 1}`

    if (!question.label.trim()) errors.push(`${questionLabel} needs text.`)

    if (question.type === "singleChoice" || question.type === "multipleChoice") {
      const validOptions = question.options.filter(option => option.label.trim())

      if (validOptions.length < 2) errors.push(`${questionLabel} needs at least two options.`)
    }
  }

  return errors
}

const makeFieldTag = (field: CommunityFormFieldInput) => [
  "field",
  field.id.trim(),
  field.type || "text",
  field.label.trim(),
  field.options?.length
    ? JSON.stringify(
        field.options.map(option => [
          option.id.trim(),
          option.label.trim(),
          stringifySettings(option.settings),
        ]),
      )
    : "",
  stringifySettings(field.settings),
]

export const makeAdmissionFormTemplate = ({
  identifier,
  communityPubkey,
  sectionName,
  name,
  description,
  relays,
  fields,
}: {
  identifier: string
  communityPubkey: string
  sectionName: string
  name: string
  description?: string
  relays?: string[]
  fields: CommunityFormFieldInput[]
}): EventContent & {kind: typeof FORM_TEMPLATE_KIND} => ({
  kind: FORM_TEMPLATE_KIND,
  content: "",
  tags: [
    ["d", identifier.trim()],
    ["a", makeCommunityDefinitionAddress(communityPubkey)],
    ["content", normalizeCommunitySectionName(sectionName)],
    ["name", name.trim() || `${sectionName} application`],
    ["settings", stringifySettings(description?.trim() ? {description: description.trim()} : {})],
    ...normalizeRelays(relays || []).map(relay => ["relay", relay]),
    ...fields.filter(field => field.id.trim() && field.label.trim()).map(makeFieldTag),
  ],
})

const parseOption = (value: unknown): CommunityFormOption | undefined => {
  if (!Array.isArray(value)) return undefined

  const id = String(value[0] || "").trim()
  const label = String(value[1] || "").trim()
  const rawSettings = value[2]
  const settings =
    typeof rawSettings === "string"
      ? safeJsonObject(rawSettings)
      : rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
        ? (rawSettings as Record<string, unknown>)
        : emptySettings

  return id && label ? {id, label, settings} : undefined
}

export const parseAdmissionForm = (event: TrustedEvent): CommunityAdmissionForm | undefined => {
  if (event.kind !== FORM_TEMPLATE_KIND) return undefined

  const pubkey = normalizePubkey(event.pubkey || "")
  const identifier = getDTag(event)
  const address = makeAdmissionFormAddress(pubkey, identifier)
  if (!address) return undefined

  const settings = safeJsonObject(event.tags.find(tag => tag[0] === "settings")?.[1])
  const communityRef = event.tags
    .filter(tag => tag[0] === "a")
    .map(tag => parseCommunityDefinitionAddress(tag[1] || ""))
    .find(Boolean)
  const fields: Record<string, CommunityFormField> = {}
  const fieldOrder: string[] = []

  for (const tag of event.tags) {
    if (tag[0] !== "field") continue

    const id = (tag[1] || "").trim()
    const type = (tag[2] || "").trim()
    const label = (tag[3] || "").trim()
    if (!id || !type) continue

    fields[id] = {
      id,
      type,
      label,
      options: safeJsonArray(tag[4]).map(parseOption).filter(Boolean) as CommunityFormOption[],
      settings: safeJsonObject(tag[5]),
    }
    fieldOrder.push(id)
  }

  return {
    event,
    address,
    pubkey,
    identifier,
    name: event.tags.find(tag => tag[0] === "name")?.[1]?.trim() || identifier,
    settings,
    description: typeof settings.description === "string" ? settings.description : undefined,
    relays: normalizeRelays(event.tags.filter(tag => tag[0] === "relay").map(tag => tag[1] || "")),
    communityAddress: communityRef?.address,
    communityPubkey: communityRef?.pubkey,
    sectionName:
      normalizeCommunitySectionName(event.tags.find(tag => tag[0] === "content")?.[1] || "") ||
      undefined,
    fields,
    fieldOrder,
  }
}

const isPreferredEvent = (candidate: TrustedEvent, current: TrustedEvent | undefined) => {
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at

  return candidate.id < current.id
}

export const selectLatestFormByAddress = (events: TrustedEvent[]) => {
  const latest = new Map<string, CommunityAdmissionForm>()

  for (const event of events) {
    const form = parseAdmissionForm(event)
    if (!form) continue

    const current = latest.get(form.address)
    if (isPreferredEvent(form.event, current?.event)) latest.set(form.address, form)
  }

  return Array.from(latest.values())
}

export const selectActiveAdmissionForm = ({
  events,
  communityPubkey,
  sectionName,
  moderatorPubkeys,
}: {
  events: TrustedEvent[]
  communityPubkey: string
  sectionName: string
  moderatorPubkeys?: string[]
}) => {
  const communityAddress = makeCommunityDefinitionAddress(communityPubkey)
  const moderators = new Set((moderatorPubkeys || []).map(normalizePubkey).filter(Boolean))
  const filterModerators = Boolean(moderatorPubkeys)
  let selected: CommunityAdmissionForm | undefined

  for (const form of selectLatestFormByAddress(events)) {
    if (form.communityAddress !== communityAddress) continue
    if (
      normalizeCommunitySectionName(form.sectionName || "") !==
      normalizeCommunitySectionName(sectionName)
    )
      continue
    if (filterModerators && !moderators.has(form.pubkey)) continue
    if (isPreferredEvent(form.event, selected?.event)) selected = form
  }

  return selected
}

export const parseAdmissionResponse = (event: TrustedEvent): CommunityFormResponse | undefined => {
  if (event.kind !== FORM_RESPONSE_KIND) return undefined

  const formAddress = event.tags.find(tag => tag[0] === "a")?.[1] || ""
  if (!formAddress) return undefined

  const responses: CommunityFormResponseValue[] = []
  const values: Record<string, string> = {}

  for (const tag of event.tags) {
    if (tag[0] !== "response") continue

    const fieldId = (tag[1] || "").trim()
    if (!fieldId) continue

    const value = tag[2] || ""
    values[fieldId] = value
    responses.push({fieldId, value, metadata: safeJsonObject(tag[3])})
  }

  return {event, formAddress, values, responses}
}

export const getAdmissionResponseDisplayValue = (
  field: CommunityFormField | undefined,
  value: string,
  metadata: Record<string, unknown> = {},
) => {
  if (field?.type !== "option") return value

  const values = value
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
  const options = new Map(field.options.map(option => [option.id, option]))
  const rawOther = metadata.other
  const otherAnswers =
    rawOther && typeof rawOther === "object" && !Array.isArray(rawOther)
      ? (rawOther as Record<string, unknown>)
      : emptySettings

  return values
    .map(item => {
      const option = options.get(item)
      const label = option?.label || item
      const otherAnswer = option?.settings.isOther === true ? otherAnswers[item] : undefined

      return typeof otherAnswer === "string" && otherAnswer.trim()
        ? `${label}: ${otherAnswer.trim()}`
        : label
    })
    .join(", ")
}

export const makeAdmissionResponse = ({
  formAddress,
  values,
  metadata,
}: {
  formAddress: string
  values: Record<string, string | string[]>
  metadata?: Record<string, Record<string, unknown>>
}): EventContent & {kind: typeof FORM_RESPONSE_KIND} => ({
  kind: FORM_RESPONSE_KIND,
  content: "",
  tags: [
    ["a", formAddress],
    ...Object.entries(values).map(([fieldId, value]) => [
      "response",
      fieldId,
      Array.isArray(value) ? value.join(";") : value,
      stringifySettings(metadata?.[fieldId]),
    ]),
  ],
})

export const makeAdmissionResponseDelete = ({
  responseId,
  reason = "Deleted application submission",
}: {
  responseId: string
  reason?: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: reason,
  tags: [
    ["e", responseId],
    ["k", String(FORM_RESPONSE_KIND)],
  ],
})

export const isAdmissionResponseDeleted = (
  response: CommunityFormResponse,
  deleteEvents: TrustedEvent[],
) =>
  deleteEvents.some(event => {
    if (event.kind !== DELETE) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(response.event.pubkey || ""))
      return false
    if (!event.tags.some(tag => tag[0] === "e" && tag[1] === response.event.id)) return false

    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return kindTags.length === 0 || kindTags.some(tag => tag[1] === String(FORM_RESPONSE_KIND))
  })

export const selectActiveAdmissionResponse = ({
  events,
  deleteEvents,
  formAddress,
  applicantPubkey,
}: {
  events: TrustedEvent[]
  deleteEvents: TrustedEvent[]
  formAddress: string
  applicantPubkey: string
}) => {
  const applicant = normalizePubkey(applicantPubkey)
  let selected: CommunityFormResponse | undefined

  for (const event of events) {
    const response = parseAdmissionResponse(event)
    if (!response) continue
    if (response.formAddress !== formAddress) continue
    if (normalizePubkey(response.event.pubkey || "") !== applicant) continue
    if (isAdmissionResponseDeleted(response, deleteEvents)) continue
    if (isPreferredEvent(response.event, selected?.event)) selected = response
  }

  return selected
}

export const parseAdmissionReview = (event: TrustedEvent): CommunityFormReview | undefined => {
  if (event.kind !== COMMUNITY_FORM_REVIEW_KIND) return undefined
  if (event.content !== "+" && event.content !== "-") return undefined

  const responseId = event.tags.find(tag => tag[0] === "e")?.[1]
  if (!responseId) return undefined

  const kindTags = event.tags.filter(tag => tag[0] === "k")
  if (kindTags.length && !kindTags.some(tag => tag[1] === String(FORM_RESPONSE_KIND)))
    return undefined

  return {
    event,
    responseId,
    applicantPubkey: event.tags.find(tag => tag[0] === "p")?.[1],
    status: event.content === "+" ? "granted" : "rejected",
  }
}

export const makeAdmissionReview = ({
  responseId,
  applicantPubkey,
  status,
}: {
  responseId: string
  applicantPubkey: string
  status: CommunityFormReviewStatus
}): EventContent & {kind: typeof COMMUNITY_FORM_REVIEW_KIND} => ({
  kind: COMMUNITY_FORM_REVIEW_KIND,
  content: status === "granted" ? "+" : "-",
  tags: [
    ["e", responseId],
    ["p", normalizePubkey(applicantPubkey)],
    ["k", String(FORM_RESPONSE_KIND)],
  ],
})

export const selectLatestAdmissionReview = ({
  events,
  responseId,
  moderatorPubkeys,
}: {
  events: TrustedEvent[]
  responseId: string
  moderatorPubkeys?: string[]
}) => {
  const moderators = new Set((moderatorPubkeys || []).map(normalizePubkey).filter(Boolean))
  const filterModerators = Boolean(moderatorPubkeys)
  let selected: CommunityFormReview | undefined

  for (const event of events) {
    const review = parseAdmissionReview(event)
    if (!review) continue
    if (review.responseId !== responseId) continue
    if (filterModerators && !moderators.has(normalizePubkey(review.event.pubkey || ""))) continue
    if (isPreferredEvent(review.event, selected?.event)) selected = review
  }

  return selected
}

export const getAdmissionSubmissionState = ({
  responseEvents,
  deleteEvents,
  reviewEvents,
  formAddress,
  applicantPubkey,
  moderatorPubkeys,
  profileListGranted = false,
}: {
  responseEvents: TrustedEvent[]
  deleteEvents: TrustedEvent[]
  reviewEvents: TrustedEvent[]
  formAddress: string
  applicantPubkey: string
  moderatorPubkeys?: string[]
  profileListGranted?: boolean
}): CommunitySubmissionState => {
  const response = selectActiveAdmissionResponse({
    events: responseEvents,
    deleteEvents,
    formAddress,
    applicantPubkey,
  })

  if (!response) return {status: profileListGranted ? "granted" : "none"}
  if (profileListGranted) return {status: "granted", response}

  const review = selectLatestAdmissionReview({
    events: reviewEvents,
    responseId: response.event.id,
    moderatorPubkeys,
  })

  if (review?.status === "granted") return {status: "granted", response, review}
  if (review?.status === "rejected") return {status: "rejected", response, review}

  return {status: "pending", response}
}

export const getAdmissionFormRelayHints = (
  form: CommunityAdmissionForm,
  communityRelays: string[],
) =>
  form.relays.length
    ? form.relays
    : normalizeRelays(communityRelays.map(relay => normalizeRelay(relay)))
