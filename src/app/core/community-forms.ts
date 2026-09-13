import {DELETE, type EventContent, type TrustedEvent} from "@welshman/util"
import {
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  type CommunityPointer,
  deleteMatchesCommunity,
  makeCommunityAuthorityTags,
  makeCommunityDeleteTags,
  makeCommunityChildIdentifier,
  normalizeCommunitySectionName,
  normalizePubkey,
  normalizeRelay,
  normalizeRelays,
  parseCommunityAuthority,
  parseOwnerPubkey,
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
  community: CommunityPointer
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
  community: CommunityPointer
  formAddress: string
  values: Record<string, string>
  responses: CommunityFormResponseValue[]
}

export type CommunityFormReviewStatus = "granted" | "rejected"

export type CommunityFormReview = {
  event: TrustedEvent
  responseId: string
  applicantPubkey: string
  formAddress: string
  community: CommunityPointer
  sectionName?: string
  status: CommunityFormReviewStatus
}

export type CommunitySubmissionStatus = "none" | "pending" | "granted" | "rejected"
export type CommunityAdmissionReviewDisplayStatus = CommunitySubmissionStatus | "review-loading"

export type CommunitySubmissionState = {
  status: CommunitySubmissionStatus
  response?: CommunityFormResponse
  review?: CommunityFormReview
}

export type CommunityAdmissionReviewHistory = {
  reviews: CommunityFormReview[]
  priorReviews: CommunityFormReview[]
  latestReview?: CommunityFormReview
  latestPriorReview?: CommunityFormReview
  grantedCount: number
  rejectedCount: number
}

export const getAdmissionReviewDisplayStatus = (
  state: CommunitySubmissionState,
  reviewEvidenceLoading = false,
): CommunityAdmissionReviewDisplayStatus =>
  reviewEvidenceLoading && state.status === "pending" ? "review-loading" : state.status

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

export const makeAdmissionFormAddress = (pubkey: string, identifier: string) => {
  const normalizedPubkey = normalizePubkey(pubkey)
  const normalizedIdentifier = identifier.trim()

  return normalizedPubkey && normalizedIdentifier
    ? `${FORM_TEMPLATE_KIND}:${normalizedPubkey}:${normalizedIdentifier}`
    : ""
}

const parseAdmissionFormAddress = (address: string) => {
  const [kind, pubkeyValue, ...identifierParts] = address.split(":")
  const pubkey = parseOwnerPubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")
  if (kind !== String(FORM_TEMPLATE_KIND) || !pubkey || !identifier) return undefined

  return makeAdmissionFormAddress(pubkey, identifier) === address ? address : undefined
}

const stringifySettings = (settings?: Record<string, unknown>) => JSON.stringify(settings || {})

const makeOptionalTag = (name: string, value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value).trim()

  return text ? [[name, text]] : []
}

const slugify = (value: string, fallback: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback

export const makeAdmissionFormIdentifier = ({
  community,
  sectionName,
}: {
  community: CommunityPointer
  sectionName: string
}) =>
  makeCommunityChildIdentifier(
    community.communityId,
    "form",
    `${slugify(normalizeCommunitySectionName(sectionName), "section")}-application`,
  ) || ""

export const makeDefaultAdmissionFormDraft = ({
  community,
  sectionName,
}: {
  community: CommunityPointer
  sectionName: string
}): CommunityAdmissionFormDraft => ({
  sectionName,
  identifier: makeAdmissionFormIdentifier({community, sectionName}),
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
  community,
  sectionName,
  currentModeratorPubkey,
}: {
  form?: CommunityAdmissionForm
  community: CommunityPointer
  sectionName: string
  currentModeratorPubkey?: string
}): CommunityAdmissionFormDraft => {
  if (!form) return makeDefaultAdmissionFormDraft({community, sectionName})

  const currentModerator = normalizePubkey(currentModeratorPubkey || "")
  const identifier =
    currentModerator && form.pubkey === currentModerator
      ? form.identifier
      : makeAdmissionFormIdentifier({community, sectionName})

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
  community,
  sectionName,
  name,
  description,
  relays,
  fields,
}: {
  identifier: string
  community: CommunityPointer
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
    ...makeCommunityAuthorityTags(community, community.relayHints[0], [
      ["content", normalizeCommunitySectionName(sectionName)],
      ["name", name.trim() || `${sectionName} application`],
      ["settings", stringifySettings(description?.trim() ? {description: description.trim()} : {})],
      ...normalizeRelays(relays || []).map(relay => ["relay", relay]),
      ...fields.filter(field => field.id.trim() && field.label.trim()).map(makeFieldTag),
    ]),
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
  const dTags = event.tags.filter(tag => tag[0] === "d")
  const identifier = dTags[0]?.[1] || ""
  const address = makeAdmissionFormAddress(pubkey, identifier)
  const community = parseCommunityAuthority(event)
  if (dTags.length !== 1 || dTags[0].length !== 2 || !address || !community) return undefined

  const settings = safeJsonObject(event.tags.find(tag => tag[0] === "settings")?.[1])
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
    community,
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
  community,
  sectionName,
  moderatorPubkeys,
}: {
  events: TrustedEvent[]
  community: CommunityPointer
  sectionName: string
  moderatorPubkeys?: string[]
}) => {
  const moderators = new Set((moderatorPubkeys || []).map(normalizePubkey).filter(Boolean))
  const filterModerators = Boolean(moderatorPubkeys)
  let selected: CommunityAdmissionForm | undefined

  for (const form of selectLatestFormByAddress(events)) {
    if (form.community.address !== community.address) continue
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

  const community = parseCommunityAuthority(event)
  const formTags = event.tags.filter(tag => tag[0] === "a" && tag[3] === "form")
  const formAddress = formTags[0]?.[1] || ""
  if (
    !community ||
    formTags.length !== 1 ||
    formTags[0].length !== 4 ||
    !parseAdmissionFormAddress(formAddress)
  ) {
    return undefined
  }

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

  return {event, community, formAddress, values, responses}
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
  community,
  formAddress,
  values,
  metadata,
}: {
  community: CommunityPointer
  formAddress: string
  values: Record<string, string | string[]>
  metadata?: Record<string, Record<string, unknown>>
}): EventContent & {kind: typeof FORM_RESPONSE_KIND} => {
  if (!parseAdmissionFormAddress(formAddress)) throw new Error("Invalid admission form address.")

  return {
    kind: FORM_RESPONSE_KIND,
    content: "",
    tags: [
      ...makeCommunityAuthorityTags(community, community.relayHints[0], [
        ["a", formAddress, "", "form"],
        ...Object.entries(values).map(([fieldId, value]) => [
          "response",
          fieldId,
          Array.isArray(value) ? value.join(";") : value,
          stringifySettings(metadata?.[fieldId]),
        ]),
      ]),
    ],
  }
}

export const makeAdmissionResponseDelete = ({
  community,
  responseId,
  reason = "Deleted application submission",
}: {
  community: CommunityPointer
  responseId: string
  reason?: string
}): EventContent & {kind: typeof DELETE} => ({
  kind: DELETE,
  content: reason,
  tags: makeCommunityDeleteTags(community, [
    ["e", responseId],
    ["k", String(FORM_RESPONSE_KIND)],
  ]),
})

export const isAdmissionResponseDeleted = (
  response: CommunityFormResponse,
  deleteEvents: TrustedEvent[],
) =>
  deleteEvents.some(event => {
    if (event.kind !== DELETE) return false
    if (normalizePubkey(event.pubkey || "") !== normalizePubkey(response.event.pubkey || ""))
      return false
    if (!deleteMatchesCommunity(event, response.community)) return false
    const eventTags = event.tags.filter(tag => tag[0] === "e")
    const kindTags = event.tags.filter(tag => tag[0] === "k")
    return (
      eventTags.length === 1 &&
      eventTags[0].length === 2 &&
      eventTags[0][1] === response.event.id &&
      kindTags.length === 1 &&
      kindTags[0].length === 2 &&
      kindTags[0][1] === String(FORM_RESPONSE_KIND)
    )
  })

export const selectActiveAdmissionResponse = ({
  community,
  events,
  deleteEvents,
  formAddress,
  applicantPubkey,
}: {
  community: CommunityPointer
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
    if (response.community.address !== community.address) continue
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

  const community = parseCommunityAuthority(event)
  const responseTags = event.tags.filter(tag => tag[0] === "e" && tag[4] === "response")
  const responseId = responseTags[0]?.[1]
  const formTags = event.tags.filter(tag => tag[0] === "a" && tag[3] === "form")
  const applicantTags = event.tags.filter(tag => tag[0] === "p")
  const applicantPubkey = parseOwnerPubkey(applicantTags[0]?.[1] || "")
  if (
    !community ||
    responseTags.length !== 1 ||
    responseTags[0].length !== 5 ||
    !responseId ||
    formTags.length !== 1 ||
    formTags[0].length !== 4 ||
    !parseAdmissionFormAddress(formTags[0][1] || "") ||
    applicantTags.length !== 1 ||
    applicantTags[0].length !== 2 ||
    !applicantPubkey
  ) {
    return undefined
  }

  const kindTags = event.tags.filter(tag => tag[0] === "k")
  if (kindTags.length && !kindTags.some(tag => tag[1] === String(FORM_RESPONSE_KIND)))
    return undefined

  return {
    event,
    responseId,
    applicantPubkey,
    formAddress: formTags[0][1],
    community,
    sectionName:
      normalizeCommunitySectionName(event.tags.find(tag => tag[0] === "content")?.[1] || "") ||
      undefined,
    status: event.content === "+" ? "granted" : "rejected",
  }
}

export const makeAdmissionReview = ({
  responseId,
  applicantPubkey,
  formAddress,
  community,
  sectionName = "",
  relays = [],
  status,
}: {
  responseId: string
  applicantPubkey: string
  formAddress: string
  community: CommunityPointer
  sectionName?: string
  relays?: string[]
  status: CommunityFormReviewStatus
}): EventContent & {kind: typeof COMMUNITY_FORM_REVIEW_KIND} => {
  const applicant = parseOwnerPubkey(applicantPubkey)
  if (!responseId || !applicant || !parseAdmissionFormAddress(formAddress)) {
    throw new Error("Invalid admission review reference.")
  }

  return {
    kind: COMMUNITY_FORM_REVIEW_KIND,
    content: status === "granted" ? "+" : "-",
    tags: [
      ...makeCommunityAuthorityTags(community, community.relayHints[0], [
        ["e", responseId, "", "", "response"],
        ["p", applicant],
        ["k", String(FORM_RESPONSE_KIND)],
        ["a", formAddress, "", "form"],
        ...makeOptionalTag("content", normalizeCommunitySectionName(sectionName)),
        ...normalizeRelays(relays).map(relay => ["relay", relay]),
      ]),
    ],
  }
}

export const selectLatestAdmissionReview = ({
  events,
  community,
  responseId,
  formAddress,
  applicantPubkey,
  moderatorPubkeys,
}: {
  events: TrustedEvent[]
  community: CommunityPointer
  responseId: string
  formAddress: string
  applicantPubkey: string
  moderatorPubkeys?: string[]
}) => {
  const applicant = normalizePubkey(applicantPubkey)
  const moderators = new Set((moderatorPubkeys || []).map(normalizePubkey).filter(Boolean))
  const filterModerators = Boolean(moderatorPubkeys)
  let selected: CommunityFormReview | undefined

  for (const event of events) {
    const review = parseAdmissionReview(event)
    if (!review) continue
    if (review.community.address !== community.address) continue
    if (review.responseId !== responseId) continue
    if (review.formAddress !== formAddress) continue
    if (normalizePubkey(review.applicantPubkey) !== applicant) continue
    if (filterModerators && !moderators.has(normalizePubkey(review.event.pubkey || ""))) continue
    if (isPreferredEvent(review.event, selected?.event)) selected = review
  }

  return selected
}

const sortReviewsNewestFirst = (a: CommunityFormReview, b: CommunityFormReview) => {
  if (a.event.created_at !== b.event.created_at) return b.event.created_at - a.event.created_at

  return a.event.id.localeCompare(b.event.id)
}

export const getAdmissionReviewHistory = ({
  reviewEvents,
  applicantPubkey,
  community,
  sectionName,
  formAddress,
  moderatorPubkeys,
  excludeResponseId,
}: {
  reviewEvents: TrustedEvent[]
  applicantPubkey: string
  community?: CommunityPointer
  sectionName?: string
  formAddress?: string
  moderatorPubkeys?: string[]
  excludeResponseId?: string
}): CommunityAdmissionReviewHistory => {
  const applicant = normalizePubkey(applicantPubkey)
  const section = normalizeCommunitySectionName(sectionName || "")
  const moderators = new Set((moderatorPubkeys || []).map(normalizePubkey).filter(Boolean))
  const filterModerators = Boolean(moderatorPubkeys)
  const reviewsById = new Map<string, CommunityFormReview>()

  for (const event of reviewEvents) {
    const review = parseAdmissionReview(event)
    if (!review) continue
    if (!applicant || normalizePubkey(review.applicantPubkey || "") !== applicant) continue
    if (community && review.community.address !== community.address) continue
    if (section && normalizeCommunitySectionName(review.sectionName || "") !== section) continue
    if (formAddress && review.formAddress !== formAddress) continue
    if (filterModerators && !moderators.has(normalizePubkey(review.event.pubkey || ""))) continue

    reviewsById.set(review.event.id, review)
  }

  const reviews = Array.from(reviewsById.values()).sort(sortReviewsNewestFirst)
  const priorReviews = excludeResponseId
    ? reviews.filter(review => review.responseId !== excludeResponseId)
    : reviews

  return {
    reviews,
    priorReviews,
    latestReview: reviews[0],
    latestPriorReview: priorReviews[0],
    grantedCount: reviews.filter(review => review.status === "granted").length,
    rejectedCount: reviews.filter(review => review.status === "rejected").length,
  }
}

export const getAdmissionSubmissionState = ({
  community,
  responseEvents,
  deleteEvents,
  reviewEvents,
  formAddress,
  applicantPubkey,
  moderatorPubkeys,
  profileListGranted = false,
}: {
  community: CommunityPointer
  responseEvents: TrustedEvent[]
  deleteEvents: TrustedEvent[]
  reviewEvents: TrustedEvent[]
  formAddress: string
  applicantPubkey: string
  moderatorPubkeys?: string[]
  profileListGranted?: boolean
}): CommunitySubmissionState => {
  const response = selectActiveAdmissionResponse({
    community,
    events: responseEvents,
    deleteEvents,
    formAddress,
    applicantPubkey,
  })

  if (!response) return {status: profileListGranted ? "granted" : "none"}

  const review = selectLatestAdmissionReview({
    events: reviewEvents,
    community,
    responseId: response.event.id,
    formAddress,
    applicantPubkey,
    moderatorPubkeys,
  })

  if (review?.status === "rejected") return {status: "rejected", response, review}
  if (profileListGranted) return {status: "granted", response, review}
  if (review?.status === "granted") return {status: "granted", response, review}

  return {status: "pending", response}
}

export const getAdmissionFormRelayHints = (
  form: CommunityAdmissionForm,
  communityRelays: string[],
) =>
  form.relays.length
    ? form.relays
    : normalizeRelays(communityRelays.map(relay => normalizeRelay(relay)))
