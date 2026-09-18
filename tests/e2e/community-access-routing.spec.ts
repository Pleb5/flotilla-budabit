import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey, nip19} from "nostr-tools"
import {DEV_PUBKEY, DEV_SECRET, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const ownerSecret = new Uint8Array(32).fill(7)
const owner = getPublicKey(ownerSecret)
const communityId = getPublicKey(new Uint8Array(32).fill(8))
const relayUrl = "wss://access-routing.example"
const address = `32222:${owner}:${communityId}`
const authority = [
  ["h", communityId],
  ["a", address, relayUrl, "community"],
]
const path = `/c/${nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId, relays: [relayUrl]})}/access`
const now = Math.floor(Date.now() / 1000)
const sections = [
  {name: "Hiring team", kind: 32767, id: "jobs"},
  {name: "Skills & services", kind: 32765, id: "services"},
  {name: "Reviews", kind: 1986, id: "reviews"},
]

const definition = finalizeEvent(
  {
    kind: 32222,
    content: "",
    created_at: now - 100,
    tags: [
      ["d", communityId],
      ["name", "Access Routing Community"],
      ["r", relayUrl],
      ...sections.flatMap(section => [
        ["content", section.name],
        ["k", String(section.kind)],
        ["a", `30000:${owner}:${communityId}-${section.id}`, relayUrl],
      ]),
    ],
  },
  ownerSecret,
)
const forms = sections.slice(0, 2).map(section =>
  finalizeEvent(
    {
      kind: 30168,
      content: "",
      created_at: now - 90,
      tags: [
        ["d", `${section.id}-application`],
        ...authority,
        ["content", section.name],
        ["name", `${section.name} application`],
        ["field", "why", "text", "Why participate?"],
      ],
    },
    ownerSecret,
  ),
)
const formAddress = `30168:${owner}:jobs-application`
const response = finalizeEvent(
  {
    kind: 1069,
    content: "",
    created_at: now - 60,
    tags: [
      ...authority,
      ["a", formAddress, "", "form"],
      ["response", "why", "To hire community members."],
    ],
  },
  Uint8Array.from(Buffer.from(DEV_SECRET, "hex")),
)
const rejection = finalizeEvent(
  {
    kind: 7,
    content: "-",
    created_at: now - 30,
    tags: [
      ...authority,
      ["e", response.id, "", "", "response"],
      ["p", DEV_PUBKEY],
      ["k", "1069"],
      ["a", formAddress, "", "form"],
      ["content", "Hiring team"],
      ["relay", relayUrl],
    ],
  },
  ownerSecret,
)
const lists = (granted = false) =>
  sections.map(section =>
    finalizeEvent(
      {
        kind: 30000,
        content: "",
        created_at: now - 100,
        tags: [
          ["d", `${communityId}-${section.id}`],
          ...(granted && section.id === "jobs" ? [["p", DEV_PUBKEY]] : []),
        ],
      },
      ownerSecret,
    ),
  )

test("an action link resolves the current section and only its authorized request form", async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await seedDevSession(page)
  // A newer form under another exact branch must not win just because its section matches.
  const siblingSecret = new Uint8Array(32).fill(9)
  const siblingForm = finalizeEvent(
    {
      ...forms[0],
      created_at: now,
      tags: [
        ["d", "sibling-application"],
        ["h", communityId],
        ["a", `32222:${getPublicKey(siblingSecret)}:${communityId}`, relayUrl, "community"],
        ["content", "Hiring team"],
        ["name", "Wrong branch application"],
        ["field", "why", "text", "Wrong question"],
      ],
    },
    siblingSecret,
  )
  await new MockRelay({seedEvents: [definition, ...lists(), ...forms, siblingForm]}).setup(page)
  await page.goto(`${path}?section=Old%20Freelance&kind=32767`)
  const target = page.getByRole("region", {name: "Hiring team publishing access", exact: true})
  await expect(target.getByText("Hiring team application", {exact: true})).toBeVisible()
  await expect(target.getByRole("button", {name: "Submit application"})).toBeEnabled()
  await expect(target).toBeFocused()
  await expect(page.locator("form")).toHaveCount(1)
  await expect(page.getByText("Wrong branch application", {exact: true})).toHaveCount(0)
  await target.screenshot({path: info.outputPath("targeted-request-desktop.png")})

  await page.getByRole("button", {name: "View all publishing requests"}).click()
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.getByText("Skills & services application", {exact: true})).toBeVisible()

  // Narrow layout and another kind select a different form, despite a wrong section hint.
  await page.setViewportSize({width: 390, height: 844})
  await page.goto(`${path}?section=Hiring%20team&kind=32765`)
  const serviceTarget = page.getByRole("region", {
    name: "Skills & services publishing access",
    exact: true,
  })
  await expect(serviceTarget.getByRole("button", {name: "Submit application"})).toBeEnabled()
  await expect(serviceTarget).toBeFocused()
  await expect(page.locator("form")).toHaveCount(1)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({path: info.outputPath("targeted-request-mobile.png")})
  expect(errors).toEqual([])
})

for (const state of ["pending", "rejected", "granted"] as const) {
  test(`an action link shows the existing ${state} request instead of another application`, async ({
    page,
  }) => {
    await seedDevSession(page)
    await new MockRelay({
      seedEvents: [
        definition,
        ...lists(state === "granted"),
        ...forms,
        ...(state !== "granted" ? [response] : []),
        ...(state === "rejected" ? [rejection] : []),
      ],
    }).setup(page)
    await page.goto(`${path}?section=Freelance&kind=32767`)
    const target = page.getByRole("region", {name: "Hiring team publishing access", exact: true})
    await expect(
      target.getByText(
        state === "pending"
          ? "This application is pending moderator review."
          : state === "rejected"
            ? /This application was rejected/
            : "Access is granted for this section.",
      ),
    ).toBeVisible()
    await expect(page.getByRole("button", {name: "Submit application"})).toHaveCount(0)
    if (state !== "granted") {
      await expect(target.getByRole("textbox")).toBeDisabled()
      await expect(target.getByRole("textbox")).toHaveValue("To hire community members.")
    }
  })
}

test("missing forms and unsupported descriptors do not select an unrelated request", async ({
  page,
}) => {
  await seedDevSession(page)
  await new MockRelay({seedEvents: [definition, ...lists(), ...forms]}).setup(page)
  await page.goto(`${path}?section=Hiring%20team&kind=1986`)
  const target = page.getByRole("region", {name: "Reviews publishing access", exact: true})
  await expect(
    target.getByText("No application form is currently available for this section."),
  ).toBeVisible()
  await expect(page.locator("form")).toHaveCount(0)
  for (const descriptor of ["32766", "invalid", "32765&subtype=other"]) {
    await page.goto(`${path}?section=Hiring%20team&kind=${descriptor}`)
    await expect(
      page.getByRole("status").filter({hasText: "This publishing action is not enabled"}),
    ).toBeVisible()
    await expect(page.locator("form")).toHaveCount(0)
  }
})
