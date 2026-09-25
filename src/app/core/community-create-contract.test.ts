import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("Communikeys create source contract", () => {
  it("links relay hosting guidance to the Budabit strfry fork", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const relayUrl = component.match(/const STRFRY_RELAY_URL\s*=\s*"([^"]+)"/)?.[1]

    expect(relayUrl).toBe(
      "https://budabit.club/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqyvhwumn8ghj7emjv9ehqtnzw4jxzcnfwshxxmr4vghsqpnnw3exvunek7tdhm",
    )
    expect(component).toContain("href={STRFRY_RELAY_URL}")
  })

  it("routes create and edit through kind-32222 publication only", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("createCommunity({")
    expect(component).toContain("operationId: communityCreateOperationId")
    expect(component).toContain("buildCommunityDefinition({")
    expect(component).toContain("updateCommunityDefinition(")
    expect(component).toContain("if (!isEdit) {")
    expect(component).toContain("await performCommunityCreate(validated, reportStatus)")
    expect(component).not.toContain("createProfile")
    expect(component).not.toMatch(/\bkind\s*:\s*0\b/)
    expect(component).not.toContain("makeCommunityNcommunity")
  })

  it("requires the exact active definition and retains exact readback/navigation", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("activeExactCommunityDefinition")
    expect(component).toContain("validated.community.pubkey !== exactDefinition.ownerPubkey")
    expect(component).toContain("communityId: exactDefinition.communityId")
    expect(component).toContain("getNextReplacementCreatedAt([exactDefinition.event]")
    expect(component).toContain("parseCommunityDefinition(verifiedDefinition)")
    expect(component).toContain("goto(makeExactCommunityPath(parsedDefinition.pointer))")
  })

  it("initializes edit metadata only from the exact definition", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const originalDraftState = component.slice(
      component.indexOf("const makeOriginalDraftState"),
      component.indexOf("const parseSectionDraftKind"),
    )

    expect(originalDraftState).not.toContain("communityProfile")
    expect(component).toContain("originalDraftState = makeOriginalDraftState(next)")
  })

  it("preserves unfamiliar valid services when rebuilding an edited definition", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const editPublish = component.slice(
      component.indexOf("const performCommunitySettingsPublish"),
      component.indexOf("const cancel"),
    )

    expect(editPublish).toContain("...exactDefinition.services.filter(")
    expect(editPublish).toMatch(
      /service\s*=>\s*service\.name\s*!==\s*"email-digest"\s*&&\s*service\.name\s*!==\s*"community-alerts"/,
    )
  })

  it("evicts bootstrap state by exact definition address after create and edit", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("clearCommunityBootstrapCache(parsedDefinition.pointer.address)")
    expect(component).toContain("clearCommunityBootstrapCache(exactDefinition.pointer.address)")
    expect(component).not.toContain("clearCommunityBootstrapCache(result.communityId)")
    expect(component).not.toContain("clearCommunityBootstrapCache(exactDefinition.communityId)")
  })

  it("creates migration member lists only when non-owner grants need moving", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const migration = component.slice(
      component.indexOf("const applySectionMigration"),
      component.indexOf("const makeChangeSummaryItems"),
    )

    expect(migration).toContain(".filter(pubkey => pubkey !== owner)")
    expect(migration).toContain("...(migratedPubkeys.length > 0 ? [setupProfileList] : [])")
    expect(migration).toContain("if (migratedPubkeys.length > 0)")
    expect(migration).toContain("pubkeys: migratedPubkeys")
    expect(migration).not.toContain("pubkeys: uniqueNormalizedPubkeys([\n          owner")
  })

  it("does not gate creation on another community owned by the owner", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")
    const page = readProjectFile("../../routes/explore/create-community/+page.svelte")

    expect(component).not.toContain("ensureCreateAllowed")
    expect(component).not.toContain("already has a community")
    expect(page).toContain("<CommunityCreate {operationId} />")
    expect(page).not.toContain("existingCommunityDefinition")
  })

  it("surfaces community setting errors at their fields without protocol jargon", () => {
    const component = readProjectFile("../components/CommunityCreate.svelte")

    expect(component).toContain("normalizeDefinitionRelay")
    expect(component).toContain("Review {Object.keys(errors).length}")
    expect(component).toContain("focusFirstError")
    expect(component).toContain("novalidate")
    expect(component).toContain("aria-invalid={Boolean(errors.primaryRelay)}")
    expect(component).toContain("A trailing slash is optional")
    expect(component).toContain("The community settings could not be prepared for publication")
    expect(component).not.toContain("A valid normalized community relay is required")
  })
})
