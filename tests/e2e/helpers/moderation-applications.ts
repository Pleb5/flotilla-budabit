import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"

/** Synthetic local-only applications by one author with three different decisions. */
export const moderationApplicationsFixture = (ownerSecret: Uint8Array) => {
  const owner = getPublicKey(ownerSecret)
  const applicantSecret = new Uint8Array(32).fill(7)
  const applicant = getPublicKey(applicantSecret)
  const communityId = getPublicKey(new Uint8Array(32).fill(8))
  const relay = "wss://moderation-applications.example"
  const address = `32222:${owner}:${communityId}`
  const authority = [
    ["h", communityId],
    ["a", address, relay, "community"],
  ]
  const timestamp = Math.floor(Date.now() / 1000) - 100
  const sections = ["General", "Articles", "Events"]
  const sign = (kind: number, tags: string[][], content = "", secret = ownerSecret, offset = 0) =>
    finalizeEvent({kind, tags, content, created_at: timestamp + offset}, secret)
  const definition = sign(32222, [
    ["d", communityId],
    ["name", "Moderation profile fixture"],
    ["r", relay],
    ...sections.flatMap((section, index) => [
      ["content", section],
      ["k", String([1111, 30023, 31923][index])],
      ["a", `30000:${owner}:${communityId}-${section.toLowerCase()}`, relay],
    ]),
  ])
  const lists = sections.map(section =>
    sign(30000, [["d", `${communityId}-${section.toLowerCase()}`]]),
  )
  const forms = sections.map(section =>
    sign(
      30168,
      [
        ["d", `${section}-application`],
        ...authority,
        ["content", section],
        ["name", `${section} application`],
        ["field", "q1", "text", "Why join?"],
      ],
      "",
      ownerSecret,
      1,
    ),
  )
  const applications = sections.map(section =>
    sign(
      1069,
      [
        ...authority,
        ["a", `30168:${owner}:${section}-application`, "", "form"],
        ["response", "q1", `Fixture application for ${section}`],
      ],
      "",
      applicantSecret,
      2,
    ),
  )
  const review = (index: number, granted: boolean, offset = 3) =>
    sign(
      7,
      [
        ...authority,
        ["e", applications[index].id, "", "", "response"],
        ["p", applicant],
        ["k", "1069"],
        ["a", `30168:${owner}:${sections[index]}-application`, "", "form"],
        ["content", sections[index]],
      ],
      granted ? "+" : "-",
      ownerSecret,
      offset,
    )
  const profile = sign(
    0,
    [],
    JSON.stringify({name: "Shared Applicant", about: "One author, three applications"}),
    applicantSecret,
    4,
  )
  return {
    owner,
    applicant,
    address,
    profile,
    applications,
    review,
    events: [definition, ...lists, ...forms, ...applications, review(1, true), review(2, false)],
    path: `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relay]})}/moderation`,
  }
}
