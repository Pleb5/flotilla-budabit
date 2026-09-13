import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_SECTION_THREADS,
  FORM_RESPONSE_KIND,
  FORM_TEMPLATE_KIND,
  makeCommunityAuthorityTags,
  makeCommunityPointer,
} from "./community"
import {
  COMMUNITY_FORM_REVIEW_KIND,
  getAdmissionReviewHistory,
  getAdmissionResponseDisplayValue,
  getAdmissionReviewDisplayStatus,
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
  parseAdmissionForm,
  parseAdmissionResponse,
  parseAdmissionReview,
  selectActiveAdmissionForm,
  selectActiveAdmissionResponse,
  selectLatestFormByAddress,
  validateAdmissionFormDraft,
} from "./community-forms"

const key = (value: number) => getPublicKey(new Uint8Array(32).fill(value))
const communityPubkey = key(1)
const communityId = key(2)
const moderatorPubkey = key(3)
const otherModeratorPubkey = key(4)
const applicantPubkey = key(5)
const outsiderPubkey = key(6)
const community = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId,
  relayHints: ["wss://relay.example.com"],
})!
const siblingCommunity = makeCommunityPointer({
  ownerPubkey: communityPubkey,
  communityId: key(7),
  relayHints: ["wss://sibling.example.com"],
})!

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
      ...makeCommunityAuthorityTags(community, "wss://relay.example.com", [
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
      ]),
    ],
    ...overrides,
  })

describe("community admission forms", () => {
  it("builds section-scoped form templates", () => {
    expect(
      makeAdmissionFormTemplate({
        identifier: "repo-application",
        community,
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
        ["h", communityId],
        ["a", community.address, "wss://relay.example.com", "community"],
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
      community,
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

  it("rejects malformed or mismatched form authority", () => {
    const valid = makeFormEvent()
    const otherCommunity = makeCommunityPointer({
      ownerPubkey: communityPubkey,
      communityId: key(7),
    })!

    expect(
      parseAdmissionForm(makeFormEvent({tags: [...valid.tags, ["h", communityId]]})),
    ).toBeUndefined()
    expect(
      parseAdmissionForm(
        makeFormEvent({
          tags: valid.tags.map(tag =>
            tag[0] === "a" && tag[3] === "community"
              ? ["a", otherCommunity.address, "", "community"]
              : tag,
          ),
        }),
      ),
    ).toBeUndefined()
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
        if (tag[0] === "content") return ["content", COMMUNITY_SECTION_THREADS]

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
        community,
        sectionName: "Repositories",
        moderatorPubkeys: [moderatorPubkey],
      })?.event.id,
    ).toBe("repo-form")
  })

  it("lets owner-authored forms compete by recency without overriding newer moderator forms", () => {
    const ownerOlderForm = makeFormEvent({
      id: "owner-older-form",
      pubkey: communityPubkey,
      created_at: 10,
      tags: makeFormEvent().tags.map(tag => {
        if (tag[0] === "d") return ["d", "owner-repo-application"]

        return tag
      }),
    })
    const moderatorNewerForm = makeFormEvent({id: "moderator-newer-form", created_at: 20})
    const ownerNewestForm = makeFormEvent({
      id: "owner-newest-form",
      pubkey: communityPubkey,
      created_at: 30,
      tags: ownerOlderForm.tags,
    })
    const moderatorPubkeys = [communityPubkey, moderatorPubkey]

    expect(
      selectActiveAdmissionForm({
        events: [ownerOlderForm, moderatorNewerForm],
        community,
        sectionName: "Repositories",
        moderatorPubkeys,
      })?.event.id,
    ).toBe("moderator-newer-form")
    expect(
      selectActiveAdmissionForm({
        events: [ownerOlderForm, moderatorNewerForm, ownerNewestForm],
        community,
        sectionName: "Repositories",
        moderatorPubkeys,
      })?.event.id,
    ).toBe("owner-newest-form")
  })

  it("treats an empty moderator filter as no authorized forms or reviews", () => {
    const formEvent = makeFormEvent({id: "stale-form"})
    const response = makeEvent({
      id: "response",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      tags: makeAdmissionResponse({
        community,
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
        community,
        responseId: "response",
        applicantPubkey,
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        status: "granted",
      }).tags,
    })

    expect(
      selectActiveAdmissionForm({
        events: [formEvent],
        community,
        sectionName: "Repositories",
        moderatorPubkeys: [],
      }),
    ).toBeUndefined()
    expect(
      getAdmissionSubmissionState({
        community,
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [review],
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        applicantPubkey,
        moderatorPubkeys: [],
      }).status,
    ).toBe("pending")
  })

  it("accepts owner-authored admission reviews", () => {
    const response = makeEvent({
      id: "response",
      kind: FORM_RESPONSE_KIND,
      pubkey: applicantPubkey,
      tags: makeAdmissionResponse({
        community,
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        values: {experience: "I can help."},
      }).tags,
    })
    const review = makeEvent({
      id: "owner-review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: communityPubkey,
      content: "+",
      tags: makeAdmissionReview({
        community,
        responseId: "response",
        applicantPubkey,
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        status: "granted",
      }).tags,
    })

    expect(
      getAdmissionSubmissionState({
        community,
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [review],
        formAddress: makeAdmissionFormAddress(moderatorPubkey, "repo-application"),
        applicantPubkey,
        moderatorPubkeys: [communityPubkey],
      }).status,
    ).toBe("granted")
  })

  it("builds structured drafts with generated identifiers", () => {
    const draft = makeDefaultAdmissionFormDraft({community, sectionName: "General Chat"})

    expect(draft).toMatchObject({
      identifier: `budabit-${communityId}-general-chat-application`,
      name: "General Chat application",
      description: "Request access to publish in the General Chat section.",
    })
    expect(draft.questions[0].label).toBe("Describe your application to publish in General Chat")
    expect(makeAdmissionFormIdentifier({community, sectionName: "!!!"})).toBe(
      `budabit-${communityId}-section-application`,
    )
  })

  it("copies the latest active form into a current moderator draft", () => {
    const otherModeratorForm = parseAdmissionForm(makeFormEvent({pubkey: otherModeratorPubkey}))!
    const draft = makeAdmissionFormDraftFromForm({
      form: otherModeratorForm,
      community,
      sectionName: "Repositories",
      currentModeratorPubkey: moderatorPubkey,
    })

    expect(draft.identifier).toBe(`budabit-${communityId}-repositories-application`)
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
      community,
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
      tags: makeCommunityAuthorityTags(community, "wss://relay.example.com", [
        ["a", formAddress, "", "form"],
        ["response", "experience", "I maintain protocol tools.", "{}"],
        ["response", "focus", "tools;protocols", JSON.stringify({source: "test"})],
      ]),
      ...overrides,
    })

  it("builds and parses identified form responses", () => {
    expect(
      makeAdmissionResponse({
        community,
        formAddress,
        values: {experience: "I build things", focus: ["tools", "protocols"]},
      }),
    ).toEqual({
      kind: FORM_RESPONSE_KIND,
      content: "",
      tags: [
        ["h", communityId],
        ["a", community.address, "wss://relay.example.com", "community"],
        ["a", formAddress, "", "form"],
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
      community,
      formAddress,
      values: {focus: ["tools", "other"]},
      metadata: {focus: {other: {other: "Pizza maker tools"}}},
    })

    expect(template.tags).toEqual([
      ["h", communityId],
      ["a", community.address, "wss://relay.example.com", "community"],
      ["a", formAddress, "", "form"],
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

  it("rejects responses and reviews with invalid authority or role markers", () => {
    const response = makeResponseEvent()
    const review = makeEvent({
      kind: COMMUNITY_FORM_REVIEW_KIND,
      content: "+",
      tags: makeAdmissionReview({
        community,
        responseId: response.id,
        applicantPubkey,
        formAddress,
        status: "granted",
      }).tags,
    })

    expect(
      parseAdmissionResponse(
        makeResponseEvent({
          tags: response.tags.map(tag => (tag[3] === "form" ? ["a", tag[1]] : tag)),
        }),
      ),
    ).toBeUndefined()
    expect(
      parseAdmissionResponse(makeResponseEvent({tags: [...response.tags, ["h", communityId]]})),
    ).toBeUndefined()
    expect(
      parseAdmissionReview(
        makeEvent({
          ...review,
          tags: review.tags.map(tag => (tag[4] === "response" ? ["e", tag[1]] : tag)),
        }),
      ),
    ).toBeUndefined()
    expect(
      parseAdmissionReview(makeEvent({...review, tags: [...review.tags, ["p", outsiderPubkey]]})),
    ).toBeUndefined()
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
      tags: makeAdmissionResponseDelete({community, responseId: "newer-response"}).tags,
    })
    const outsiderDelete = makeEvent({
      id: "outsider-delete",
      kind: DELETE,
      pubkey: outsiderPubkey,
      created_at: 22,
      tags: makeAdmissionResponseDelete({community, responseId: "older-response"}).tags,
    })

    expect(
      selectActiveAdmissionResponse({
        community,
        events: [older, newer],
        deleteEvents: [deleteNewer, outsiderDelete],
        formAddress,
        applicantPubkey,
      })?.event.id,
    ).toBe("older-response")
  })

  it("does not select responses or deletions injected from a sibling community", () => {
    const current = makeResponseEvent({id: "current-response", created_at: 20})
    const sibling = makeResponseEvent({
      id: "sibling-response",
      created_at: 30,
      tags: makeAdmissionResponse({
        community: siblingCommunity,
        formAddress,
        values: {experience: "Injected sibling response."},
      }).tags,
    })
    const siblingDelete = makeEvent({
      kind: DELETE,
      pubkey: applicantPubkey,
      tags: makeAdmissionResponseDelete({
        community: siblingCommunity,
        responseId: current.id,
      }).tags,
    })

    expect(
      selectActiveAdmissionResponse({
        community,
        events: [current, sibling],
        deleteEvents: [siblingDelete],
        formAddress,
        applicantPubkey,
      })?.event.id,
    ).toBe("current-response")
  })

  it("does not accept legacy or ambiguous admission response deletions", () => {
    const response = makeResponseEvent({id: "current-response"})
    const legacyDelete = makeEvent({
      kind: DELETE,
      pubkey: applicantPubkey,
      tags: [
        ["e", response.id],
        ["k", String(FORM_RESPONSE_KIND)],
      ],
    })
    const ambiguousDelete = makeEvent({
      kind: DELETE,
      pubkey: applicantPubkey,
      tags: [
        ...makeAdmissionResponseDelete({community, responseId: response.id}).tags,
        ["e", "other-response"],
      ],
    })

    expect(
      selectActiveAdmissionResponse({
        community,
        events: [response],
        deleteEvents: [legacyDelete, ambiguousDelete],
        formAddress,
        applicantPubkey,
      })?.event.id,
    ).toBe(response.id)
  })

  it("accepts deletions that carried the legacy marked community a", () => {
    const response = makeResponseEvent({id: "current-response"})
    const legacyMarkedDelete = makeEvent({
      kind: DELETE,
      pubkey: applicantPubkey,
      tags: [
        ["h", communityId],
        ["a", community.address, "", "community"],
        ["e", response.id],
        ["k", String(FORM_RESPONSE_KIND)],
      ],
    })

    expect(
      selectActiveAdmissionResponse({
        community,
        events: [response],
        deleteEvents: [legacyMarkedDelete],
        formAddress,
        applicantPubkey,
      }),
    ).toBeUndefined()
  })

  it("requires reviews to match the current community, form, response, and applicant", () => {
    const response = makeResponseEvent({id: "shared-response", created_at: 20})
    const currentGrant = makeEvent({
      id: "current-grant",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 30,
      content: "+",
      tags: makeAdmissionReview({
        community,
        responseId: response.id,
        applicantPubkey,
        formAddress,
        status: "granted",
      }).tags,
    })
    const makeInjectedReview = ({
      id,
      injectedCommunity = community,
      injectedFormAddress = formAddress,
      injectedApplicant = applicantPubkey,
      createdAt,
    }: {
      id: string
      injectedCommunity?: typeof community
      injectedFormAddress?: string
      injectedApplicant?: string
      createdAt: number
    }) =>
      makeEvent({
        id,
        kind: COMMUNITY_FORM_REVIEW_KIND,
        pubkey: moderatorPubkey,
        created_at: createdAt,
        content: "-",
        tags: makeAdmissionReview({
          community: injectedCommunity,
          responseId: response.id,
          applicantPubkey: injectedApplicant,
          formAddress: injectedFormAddress,
          status: "rejected",
        }).tags,
      })
    const siblingReject = makeInjectedReview({
      id: "sibling-reject",
      injectedCommunity: siblingCommunity,
      createdAt: 40,
    })
    const otherFormReject = makeInjectedReview({
      id: "other-form-reject",
      injectedFormAddress: makeAdmissionFormAddress(moderatorPubkey, "other-application"),
      createdAt: 41,
    })
    const otherApplicantReject = makeInjectedReview({
      id: "other-applicant-reject",
      injectedApplicant: outsiderPubkey,
      createdAt: 42,
    })

    expect(
      getAdmissionSubmissionState({
        community,
        responseEvents: [response],
        deleteEvents: [],
        reviewEvents: [currentGrant, siblingReject, otherFormReject, otherApplicantReject],
        formAddress,
        applicantPubkey,
        moderatorPubkeys: [moderatorPubkey],
      }),
    ).toMatchObject({status: "granted", review: {event: {id: "current-grant"}}})
  })

  it("classifies pending, granted, and rejected submissions", () => {
    const response = makeResponseEvent({id: "response-event"})
    const grant = makeEvent({
      id: "grant-review",
      kind: COMMUNITY_FORM_REVIEW_KIND,
      pubkey: moderatorPubkey,
      created_at: 30,
      tags: makeAdmissionReview({
        community,
        responseId: "response-event",
        applicantPubkey,
        formAddress,
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
        community,
        responseId: "response-event",
        applicantPubkey,
        formAddress,
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
        community,
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
        community,
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
        community,
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
        community,
        responseId: "old-response",
        applicantPubkey,
        formAddress,
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
        community,
        responseId: "current-response",
        applicantPubkey,
        formAddress,
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
        community,
        responseId: "wrong-section-response",
        applicantPubkey,
        formAddress,
        sectionName: COMMUNITY_SECTION_THREADS,
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
      community,
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

  it("labels pending applications as review-loading while evidence is incomplete", () => {
    expect(getAdmissionReviewDisplayStatus({status: "pending"}, true)).toBe("review-loading")
    expect(getAdmissionReviewDisplayStatus({status: "pending"}, false)).toBe("pending")
    expect(getAdmissionReviewDisplayStatus({status: "granted"}, true)).toBe("granted")
    expect(getAdmissionReviewDisplayStatus({status: "rejected"}, true)).toBe("rejected")
  })

  it("builds delete and review event templates", () => {
    expect(makeAdmissionResponseDelete({community, responseId: "response-event"})).toEqual({
      kind: DELETE,
      content: "Deleted application submission",
      tags: [
        ["h", communityId],
        ["e", "response-event"],
        ["k", "1069"],
      ],
    })
    expect(
      makeAdmissionReview({
        community,
        responseId: "response-event",
        applicantPubkey,
        formAddress,
        status: "rejected",
      }),
    ).toEqual({
      kind: COMMUNITY_FORM_REVIEW_KIND,
      content: "-",
      tags: [
        ["h", communityId],
        ["a", community.address, "wss://relay.example.com", "community"],
        ["e", "response-event", "", "", "response"],
        ["p", applicantPubkey],
        ["k", "1069"],
        ["a", formAddress, "", "form"],
      ],
    })
    expect(
      makeAdmissionReview({
        community,
        responseId: "response-event",
        applicantPubkey,
        formAddress,
        sectionName: "General",
        relays: ["wss://community.example"],
        status: "granted",
      }),
    ).toMatchObject({
      content: "+",
      tags: [
        ["h", communityId],
        ["a", community.address, "wss://relay.example.com", "community"],
        ["e", "response-event", "", "", "response"],
        ["p", applicantPubkey],
        ["k", "1069"],
        ["a", formAddress, "", "form"],
        ["content", "General"],
        ["relay", "wss://community.example/"],
      ],
    })
  })
})
