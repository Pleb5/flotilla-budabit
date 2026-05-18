import {describe, expect, it} from "vitest"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {FORM_RESPONSE_KIND, FORM_TEMPLATE_KIND} from "./community"
import {
  COMMUNITY_FORM_REVIEW_KIND,
  getAdmissionReviewHistory,
  getAdmissionResponseDisplayValue,
  getAdmissionSubmissionState,
  makeAdmissionFormDraftFromForm,
  makeAdmissionFormFieldsFromDraft,
  makeAdmissionFormAddress,
  makeAdmissionFormIdentifier,
  makeAdmissionFormTemplate,
  makeAdmissionResponse,
  makeAdmissionResponseDelete,
  makeAdmissionReview,
  makeDefaultAdmissionFormDraft,
  makeCommunityDefinitionAddress,
  parseAdmissionForm,
  parseAdmissionResponse,
  parseAdmissionReview,
  selectActiveAdmissionForm,
  selectActiveAdmissionResponse,
  selectLatestFormByAddress,
  validateAdmissionFormDraft,
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
      [
        "field",
        "experience",
        "text",
        "What experience do you have?",
        "",
        JSON.stringify({required: true}),
      ],
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
  it("builds section-scoped form templates", () => {
    expect(
      makeAdmissionFormTemplate({
        identifier: "repo-application",
        communityPubkey,
        sectionName: "Repositories",
        name: "Repository application",
        description: "Apply to publish repositories.",
        relays: ["wss://relay.example.com"],
        fields: [
          {id: "experience", label: "What experience do you have?", settings: {required: true}},
          {
            id: "focus",
            type: "option",
            label: "What will you curate?",
            options: [{id: "tools", label: "Developer tools"}],
          },
        ],
      }),
    ).toEqual({
      kind: FORM_TEMPLATE_KIND,
      content: "",
      tags: [
        ["d", "repo-application"],
        ["a", makeCommunityDefinitionAddress(communityPubkey)],
        ["content", "Repositories"],
        ["name", "Repository application"],
        ["settings", JSON.stringify({description: "Apply to publish repositories."})],
        ["relay", "wss://relay.example.com/"],
        [
          "field",
          "experience",
          "text",
          "What experience do you have?",
          "",
          JSON.stringify({required: true}),
        ],
        [
          "field",
          "focus",
          "option",
          "What will you curate?",
          JSON.stringify([["tools", "Developer tools", "{}"]]),
          "{}",
        ],
      ],
    })
  })

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
    const older = makeFormEvent({
      id: "z-old",
      created_at: 10,
      tags: [...makeFormEvent().tags, ["name", "old"]],
    })
    const newer = makeFormEvent({id: "z-new", created_at: 11})
    const tieWinner = makeFormEvent({id: "a-winner", created_at: 11})
    const latest = selectLatestFormByAddress([older, newer, tieWinner])

    expect(latest).toHaveLength(1)
    expect(latest[0].event.id).toBe("a-winner")
  })

  it("selects an active form by community, section, and moderator", () => {
    const repoForm = makeFormEvent({id: "repo-form", created_at: 10})
    const newerThreadForm = makeFormEvent({
      id: "thread-form",
      created_at: 20,
      tags: makeFormEvent().tags.map(tag => {
        if (tag[0] === "d") return ["d", "threads-application"]
        if (tag[0] === "content") return ["content", "Threads"]

        return tag
      }),
    })
    const outsiderForm = makeFormEvent({
      id: "outsider-form",
      pubkey: outsiderPubkey,
      created_at: 30,
    })

    expect(
      selectActiveAdmissionForm({
        events: [repoForm, newerThreadForm, outsiderForm],
        communityPubkey,
        sectionName: "Repositories",
        moderatorPubkeys: [moderatorPubkey],
      })?.event.id,
    ).toBe("repo-form")
  })

  it("treats an empty moderator filter as no authorized forms or reviews", () => {
    const formEvent = makeFormEvent({id: "stale-form"})
    const response = makeEvent({
      id: "response",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      tags: makeAdmissionResponse({
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        values: {experience: "I can help."},
      }).tags,
    })
    const review = makeEvent({
      id: "review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      content: "+",
      tags: makeAdmissionReview({
        responseId: "response",
        applicantPubkey,
        status: "granted",
      }).tags,
    })

    expect(
      selectActiveAdmissionForm({
        events: [formEvent],
        communityPubkey,
        sectionName: "Repositories",
        moderatorPubkeys: [],
      }),
    ).toBeUndefined()
    expect(
      getAdmissionSubmissionState({
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [review],
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        applicantPubkey,
        moderatorPubkeys: [],
      }).status,
    ).toBe("pending")
  })

  it("builds structured drafts with generated identifiers", () => {
    const draft = makeDefaultAdmissionFormDraft({communityPubkey, sectionName: "General Chat"})

    expect(draft).toMatchObject({
      identifier: `community-${communityPubkey.slice(0, 12)}-general-chat-application`,
      name: "General Chat application",
      description: "Request access to publish in the General Chat section.",
    })
    expect(draft.questions[0].label).toBe("Describe your application to publish in General Chat")
    expect(makeAdmissionFormIdentifier({communityPubkey, sectionName: "!!!"})).toBe(
      `community-${communityPubkey.slice(0, 12)}-section-application`,
    )
  })

  it("copies the latest active form into a current moderator draft", () => {
    const otherModeratorForm = parseAdmissionForm(makeFormEvent({pubkey: otherModeratorPubkey}))!
    const draft = makeAdmissionFormDraftFromForm({
      form: otherModeratorForm,
      communityPubkey,
      sectionName: "Repositories",
      currentModeratorPubkey: moderatorPubkey,
    })

    expect(draft.identifier).toBe(
      `community-${communityPubkey.slice(0, 12)}-repositories-application`,
    )
    expect(draft.name).toBe("Repository curator application")
    expect(draft.description).toBe("Tell us what you will curate.")
    expect(draft.questions).toEqual([
      {
        id: "experience",
        type: "shortAnswer",
        label: "What experience do you have?",
        required: true,
        options: [],
      },
      {
        id: "focus",
        type: "singleChoice",
        label: "What will you curate?",
        required: true,
        options: [
          {id: "tools", label: "Developer tools", isOther: false},
          {id: "protocols", label: "Protocols", isOther: false},
        ],
      },
    ])
  })

  it("preserves the current moderator form identifier while converting draft fields", () => {
    const currentModeratorForm = parseAdmissionForm(makeFormEvent())!
    const draft = makeAdmissionFormDraftFromForm({
      form: currentModeratorForm,
      communityPubkey,
      sectionName: "Repositories",
      currentModeratorPubkey: moderatorPubkey,
    })

    draft.questions = [
      {id: "q1", type: "paragraph", label: "Tell us why", required: true, options: []},
      {
        id: "q2",
        type: "multipleChoice",
        label: "What can you help with?",
        required: false,
        options: [
          {id: "docs", label: "Docs"},
          {id: "other", label: "Other", isOther: true},
        ],
      },
    ]

    expect(draft.identifier).toBe("repo-application")
    expect(makeAdmissionFormFieldsFromDraft(draft)).toEqual([
      {
        id: "q1",
        type: "text",
        label: "Tell us why",
        settings: {required: true, renderElement: "paragraph"},
      },
      {
        id: "q2",
        type: "option",
        label: "What can you help with?",
        options: [
          {id: "docs", label: "Docs", settings: {}},
          {id: "other", label: "Other", settings: {isOther: true}},
        ],
        settings: {required: false, renderElement: "multipleChoice"},
      },
    ])
  })

  it("validates structured drafts before publishing", () => {
    expect(
      validateAdmissionFormDraft({
        sectionName: "General",
        identifier: "general",
        name: "General application",
        description: "Apply for General.",
        questions: [
          {
            id: "q1",
            type: "singleChoice",
            label: "Pick one",
            required: true,
            options: [{id: "one", label: "One"}],
          },
        ],
      }),
    ).toEqual(["Question 1 needs at least two options."])
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
    expect(
      makeAdmissionResponse({
        formAddress,
        values: {experience: "I build things", focus: ["tools", "protocols"]},
      }),
    ).toEqual({
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
    expect(response.values).toEqual({
      experience: "I maintain protocol tools.",
      focus: "tools;protocols",
    })
    expect(response.responses[1]).toEqual({
      fieldId: "focus",
      value: "tools;protocols",
      metadata: {source: "test"},
    })
  })

  it("builds and parses response metadata for other explanations", () => {
    const template = makeAdmissionResponse({
      formAddress,
      values: {focus: ["tools", "other"]},
      metadata: {focus: {other: {other: "Pizza maker tools"}}},
    })

    expect(template.tags).toEqual([
      ["a", formAddress],
      ["response", "focus", "tools;other", JSON.stringify({other: {other: "Pizza maker tools"}})],
    ])

    const response = parseAdmissionResponse(
      makeEvent({kind: FORM_RESPONSE_KIND, pubkey: applicantPubkey, tags: template.tags}),
    )!

    expect(response.responses[0]).toEqual({
      fieldId: "focus",
      value: "tools;other",
      metadata: {other: {other: "Pizza maker tools"}},
    })
  })

  it("resolves choice response values to option labels", () => {
    const form = parseAdmissionForm(makeFormEvent())!
    const field = form.fields.focus

    expect(getAdmissionResponseDisplayValue(field, "tools")).toBe("Developer tools")
    expect(getAdmissionResponseDisplayValue(field, "tools;protocols")).toBe(
      "Developer tools, Protocols",
    )
    expect(getAdmissionResponseDisplayValue(field, "unknown")).toBe("unknown")
    expect(getAdmissionResponseDisplayValue(form.fields.experience, "I build things")).toBe(
      "I build things",
    )
  })

  it("resolves other choice response metadata to explanations", () => {
    const form = parseAdmissionForm(
      makeFormEvent({
        tags: makeFormEvent().tags.map(tag => {
          if (tag[0] !== "field" || tag[1] !== "focus") return tag

          return [
            "field",
            "focus",
            "option",
            "What will you curate?",
            JSON.stringify([
              ["tools", "Developer tools", "{}"],
              ["other", "Other", JSON.stringify({isOther: true})],
            ]),
            "{}",
          ]
        }),
      }),
    )!
    const field = form.fields.focus

    expect(
      getAdmissionResponseDisplayValue(field, "other", {other: {other: "Pizza maker tools"}}),
    ).toBe("Other: Pizza maker tools")
    expect(
      getAdmissionResponseDisplayValue(field, "tools;other", {other: {other: "Pizza maker tools"}}),
    ).toBe("Developer tools, Other: Pizza maker tools")
    expect(getAdmissionResponseDisplayValue(field, "other")).toBe("Other")
  })

  it("requires deleting an active submission before resubmission", () => {
    const older = makeResponseEvent({id: "older-response", created_at: 10})
    const newer = makeResponseEvent({id: "newer-response", created_at: 20})
    const deleteNewer = makeEvent({
      id: "delete-newer",
      kind: DELETE,
      pubkey: applicantPubkey,
      created_at: 21,
      tags: makeAdmissionResponseDelete({responseId: "newer-response"}).tags,
    })
    const outsiderDelete = makeEvent({
      id: "outsider-delete",
      kind: DELETE,
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

    expect(parseAdmissionReview(grant)).toMatchObject({
      responseId: "response-event",
      status: "granted",
    })
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
    ).toBe("rejected")
  })

  it("derives prior review history without relying on active responses", () => {
    const oldReject = makeEvent({
      id: "old-reject",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 30,
      tags: makeAdmissionReview({
        responseId: "old-response",
        applicantPubkey,
        formAddress,
        communityPubkey,
        sectionName: "Repositories",
        status: "rejected",
      }).tags,
      content: "-",
    })
    const currentGrant = makeEvent({
      id: "current-grant",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 40,
      tags: makeAdmissionReview({
        responseId: "current-response",
        applicantPubkey,
        formAddress,
        communityPubkey,
        sectionName: "Repositories",
        status: "granted",
      }).tags,
      content: "+",
    })
    const wrongSection = makeEvent({
      id: "wrong-section",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 50,
      tags: makeAdmissionReview({
        responseId: "wrong-section-response",
        applicantPubkey,
        formAddress,
        communityPubkey,
        sectionName: "Threads",
        status: "rejected",
      }).tags,
      content: "-",
    })
    const outsiderReview = makeEvent({
      id: "outsider-review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: outsiderPubkey,
      created_at: 60,
      tags: oldReject.tags,
      content: "-",
    })

    const history = getAdmissionReviewHistory({
      reviewEvents: [oldReject, currentGrant, wrongSection, outsiderReview, oldReject],
      applicantPubkey,
      communityPubkey,
      sectionName: "Repositories",
      moderatorPubkeys: [moderatorPubkey],
      excludeResponseId: "current-response",
    })

    expect(history.reviews.map(review => review.event.id)).toEqual(["current-grant", "old-reject"])
    expect(history.latestReview?.status).toBe("granted")
    expect(history.latestPriorReview?.event.id).toBe("old-reject")
    expect(history.latestPriorReview?.status).toBe("rejected")
    expect(history.grantedCount).toBe(1)
    expect(history.rejectedCount).toBe(1)
  })

  it("builds delete and review event templates", () => {
    expect(makeAdmissionResponseDelete({responseId: "response-event"})).toEqual({
      kind: DELETE,
      content: "Deleted application submission",
      tags: [
        ["e", "response-event"],
        ["k", "1069"],
      ],
    })
    expect(
      makeAdmissionReview({responseId: "response-event", applicantPubkey, status: "rejected"}),
    ).toEqual({
      kind: COMMUNITY_FORM_REVIEW_KIND,
      content: "-",
      tags: [
        ["e", "response-event"],
        ["p", applicantPubkey],
        ["k", "1069"],
      ],
    })
    expect(
      makeAdmissionReview({
        responseId: "response-event",
        applicantPubkey,
        formAddress,
        communityPubkey,
        sectionName: "General",
        status: "granted",
      }),
    ).toMatchObject({
      content: "+",
      tags: [
        ["e", "response-event"],
        ["p", applicantPubkey],
        ["k", "1069"],
        ["a", formAddress],
        ["h", communityPubkey],
        ["content", "General"],
      ],
    })
  })
})
