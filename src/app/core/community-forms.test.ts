import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import {FORM_RESPONSE_KIND, FORM_TEMPLATE_KIND} from "./community"
import {
  COMMUNITY_FORM_DELETE_KIND,
  COMMUNITY_FORM_REVIEW_KIND,
  getAdmissionSubmissionState,
  makeAdmissionFormAddress,
  makeAdmissionResponse,
  makeAdmissionResponseDelete,
  makeAdmissionReview,
  makeCommunityDefinitionAddress,
  parseAdmissionForm,
  parseAdmissionResponse,
  parseAdmissionReview,
  selectActiveAdmissionForm,
  selectActiveAdmissionResponse,
  selectLatestFormByAddress,
} from "./community-forms"

const communityPubkey = "a".repeat(64)
const moderatorPubkey = "b".repeat(64)
const otherModeratorPubkey = "c".repeat(64)
const applicantPubkey = "d".repeat(64)
const outsiderPubkey = "e".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: moderatorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeFormEvent = (overrides: Partial<TrustedEvent> = {}) =>
  makeEvent({
    id: "form-event",
    kind: FORM_TEMPLATE_KIND,
    pubkey: moderatorPubkey,
    created_at: 10,
    tags: [
      ["d", "repo-application"],
      ["a", makeCommunityDefinitionAddress(communityPubkey), "wss://relay.example.com"],
      ["content", "Repositories"],
      ["name", "Repository curator application"],
      ["settings", JSON.stringify({description: "Tell us what you will curate."})],
      ["relay", "wss://relay.example.com"],
      ["field", "experience", "text", "What experience do you have?", "", JSON.stringify({required: true})],
      [
        "field",
        "focus",
        "option",
        "What will you curate?",
        JSON.stringify([
          ["tools", "Developer tools"],
          ["protocols", "Protocols", JSON.stringify({featured: true})],
        ]),
        "{}",
      ],
    ],
    ...overrides,
  })

describe("community admission forms", () => {
  it("parses moderator-authored section forms", () => {
    const form = parseAdmissionForm(makeFormEvent())!

    expect(form).toMatchObject({
      address: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
      pubkey: moderatorPubkey,
      identifier: "repo-application",
      name: "Repository curator application",
      description: "Tell us what you will curate.",
      communityAddress: makeCommunityDefinitionAddress(communityPubkey),
      communityPubkey,
      sectionName: "Repositories",
      relays: ["wss://relay.example.com/"],
      fieldOrder: ["experience", "focus"],
    })
    expect(form.fields.experience).toMatchObject({
      id: "experience",
      type: "text",
      label: "What experience do you have?",
      settings: {required: true},
    })
    expect(form.fields.focus.options).toEqual([
      {id: "tools", label: "Developer tools", settings: {}},
      {id: "protocols", label: "Protocols", settings: {featured: true}},
    ])
  })

  it("selects the latest form update per address", () => {
    const older = makeFormEvent({id: "z-old", created_at: 10, tags: [...makeFormEvent().tags, ["name", "old"]]})
    const newer = makeFormEvent({id: "z-new", created_at: 11})
    const tieWinner = makeFormEvent({id: "a-winner", created_at: 11})
    const latest = selectLatestFormByAddress([older, newer, tieWinner])

    expect(latest).toHaveLength(1)
    expect(latest[0].event.id).toBe("a-winner")
  })

  it("selects an active form by community, section, and moderator", () => {
    const repoForm = makeFormEvent({id: "repo-form", created_at: 10})
    const newerForumForm = makeFormEvent({
      id: "forum-form",
      created_at: 20,
      tags: makeFormEvent().tags.map(tag => {
        if (tag[0] === "d") return ["d", "forum-application"]
        if (tag[0] === "content") return ["content", "Forum"]

        return tag
      }),
    })
    const outsiderForm = makeFormEvent({id: "outsider-form", pubkey: outsiderPubkey, created_at: 30})

    expect(
      selectActiveAdmissionForm({
        events: [repoForm, newerForumForm, outsiderForm],
        communityPubkey,
        sectionName: "Repositories",
        moderatorPubkeys: [moderatorPubkey],
      })?.event.id,
    ).toBe("repo-form")
  })
})

describe("community admission responses", () => {
  const formAddress = makeAdmissionFormAddress(moderatorPubkey, "repo-application")

  const makeResponseEvent = (overrides: Partial<TrustedEvent> = {}) =>
    makeEvent({
      id: "response-event",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      created_at: 20,
      tags: [
        ["a", formAddress],
        ["response", "experience", "I maintain protocol tools.", "{}"],
        ["response", "focus", "tools;protocols", JSON.stringify({source: "test"})],
      ],
      ...overrides,
    })

  it("builds and parses identified form responses", () => {
    expect(makeAdmissionResponse({formAddress, values: {experience: "I build things", focus: ["tools", "protocols"]}})).toEqual({
      kind: FORM_RESPONSE_KIND,
      content: "",
      tags: [
        ["a", formAddress],
        ["response", "experience", "I build things", "{}"],
        ["response", "focus", "tools;protocols", "{}"],
      ],
    })

    const response = parseAdmissionResponse(makeResponseEvent())!

    expect(response.formAddress).toBe(formAddress)
    expect(response.values).toEqual({experience: "I maintain protocol tools.", focus: "tools;protocols"})
    expect(response.responses[1]).toEqual({
      fieldId: "focus",
      value: "tools;protocols",
      metadata: {source: "test"},
    })
  })

  it("requires deleting an active submission before resubmission", () => {
    const older = makeResponseEvent({id: "older-response", created_at: 10})
    const newer = makeResponseEvent({id: "newer-response", created_at: 20})
    const deleteNewer = makeEvent({
      id: "delete-newer",
      kind: COMMUNITY_FORM_DELETE_KIND,
      pubkey: applicantPubkey,
      created_at: 21,
      tags: makeAdmissionResponseDelete({responseId: "newer-response"}).tags,
    })
    const outsiderDelete = makeEvent({
      id: "outsider-delete",
      kind: COMMUNITY_FORM_DELETE_KIND,
      pubkey: outsiderPubkey,
      created_at: 22,
      tags: makeAdmissionResponseDelete({responseId: "older-response"}).tags,
    })

    expect(
      selectActiveAdmissionResponse({
        events: [older, newer],
        deleteEvents: [deleteNewer, outsiderDelete],
        formAddress,
        applicantPubkey,
      })?.event.id,
    ).toBe("older-response")
  })

  it("classifies pending, granted, and rejected submissions", () => {
    const response = makeResponseEvent({id: "response-event"})
    const grant = makeEvent({
      id: "grant-review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 30,
      tags: makeAdmissionReview({
        responseId: "response-event",
        applicantPubkey,
        status: "granted",
      }).tags,
      content: "+",
    })
    const laterReject = makeEvent({
      id: "reject-review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 31,
      tags: makeAdmissionReview({
        responseId: "response-event",
        applicantPubkey,
        status: "rejected",
      }).tags,
      content: "-",
    })
    const outsiderGrant = makeEvent({
      id: "outsider-grant",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: outsiderPubkey,
      created_at: 40,
      tags: grant.tags,
      content: "+",
    })

    expect(parseAdmissionReview(grant)).toMatchObject({responseId: "response-event", status: "granted"})
    expect(
      getAdmissionSubmissionState({
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("pending")
    expect(
      getAdmissionSubmissionState({
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [grant, laterReject, outsiderGrant],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }).status,
    ).toBe("rejected")
    expect(
      getAdmissionSubmissionState({
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [laterReject],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
        profileListGranted: true,
      }).status,
    ).toBe("granted")
  })

  it("builds delete and review event templates", () => {
    expect(makeAdmissionResponseDelete({responseId: "response-event"})).toEqual({
      kind: COMMUNITY_FORM_DELETE_KIND,
      content: "Deleted application submission",
      tags: [
        ["e", "response-event"],
        ["k", "1069"],
      ],
    })
    expect(makeAdmissionReview({responseId: "response-event", applicantPubkey, status: "rejected"})).toEqual({
      kind: COMMUNITY_FORM_REVIEW_KIND,
      content: "-",
      tags: [
        ["e", "response-event"],
        ["p", applicantPubkey],
        ["k", "1069"],
      ],
    })
  })
})
