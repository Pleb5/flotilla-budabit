import {test, expect} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {MockRelay} from "./helpers/mock-relay"

const key = new Uint8Array(32).fill(52)
const author = getPublicKey(key)
const refs = ["first", "second"].map(d => `31923:${author}:${d}`)
const tombstones = refs.map(ref =>
  finalizeEvent({kind: 5, created_at: 290, tags: [["a", ref]], content: ""}, key),
)
const past = finalizeEvent(
  {
    kind: 31923,
    created_at: 300,
    tags: [
      ["d", "first"],
      ["title", "Explicit past featured event"],
      ["start", "1700000000"],
    ],
    content: "",
  },
  key,
)

for (const mode of ["fixed", "mixed", "missing", "baseline", "timeout"] as const) {
  test(`${mode}: actual widget protocol with signed MockRelay records`, async ({page}) => {
    const fixture = process.env.FEATURED_FIXTURE_URL
    test.skip(!fixture, "Start the paired widget fixture and set FEATURED_FIXTURE_URL")
    const relay = new MockRelay({
      seedEvents:
        mode === "missing" || mode === "timeout"
          ? []
          : mode === "mixed"
            ? [...tombstones, past]
            : tombstones,
      subscriptionOutcomesByRelay: {
        "wss://incomplete.invalid": mode === "missing" ? "eose" : "stall",
      },
    })
    await relay.setup(page)
    const url = new URL(fixture!)
    url.searchParams.set("mode", mode)
    url.searchParams.set("now", "300")
    url.searchParams.set("transport", "mock")
    await page.goto(url.toString())
    const widget = page.frameLocator("iframe")
    const expected =
      mode === "fixed"
        ? "The configured events were deleted by their authors."
        : mode === "missing"
          ? "The configured events could not be found in this community."
          : mode === "mixed"
            ? "1 configured event is no longer available."
            : "Unable to finish loading featured events."
    await expect(widget.getByText(expected, {exact: true})).toBeVisible({timeout: 20_000})
    if (mode === "mixed")
      await expect(
        widget.getByRole("heading", {name: "Explicit past featured event"}),
      ).toBeVisible()
    if (mode !== "baseline" && mode !== "timeout")
      await expect(widget.getByRole("button", {name: "Retry", exact: true})).toHaveCount(0)
    else await expect(widget.getByRole("button", {name: "Retry", exact: true})).toBeVisible()
    const trace = await page.evaluate(() => (window as any).fixtureTrace)
    expect(trace.every((query: any) => query.refs?.length === 2)).toBe(true)
    if (mode === "fixed" || mode === "missing") expect(trace).toHaveLength(1)
    expect(
      (await relay.getTelemetry())
        .filter(entry => entry.type === "req")
        .every(entry => entry.filters?.every(filter => filter["#d"] || filter["#a"])),
    ).toBe(true)
    expect(relay.getPublishedEvents()).toHaveLength(0)
  })
}
