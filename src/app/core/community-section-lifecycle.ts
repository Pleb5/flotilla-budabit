import {
  getCommunitySectionKindKey,
  getCommunitySectionKindLabel,
  normalizeCommunitySectionName,
  type CommunityDefinitionSectionInput,
} from "@app/core/community"

export type KeyedCommunitySectionInput = Pick<CommunityDefinitionSectionInput, "name" | "kinds"> & {
  originalNameKey?: string
}

export type SectionLifecycleChange =
  | {type: "rename"; oldSectionName: string; newSectionName: string}
  | {
      type: "move"
      kindKey: string
      kindLabel: string
      oldSectionName: string
      newSectionName: string
    }
  | {type: "kind-remove"; kindKey: string; kindLabel: string; oldSectionName: string}
  | {type: "remove"; oldSectionName: string}

type KeyedSectionKindAssignment = {
  key: string
  label: string
  sectionName: string
  originalNameKey?: string
}

export const getCommunitySectionNameKey = (name: string) =>
  normalizeCommunitySectionName(name).toLowerCase()

const getOriginalSectionsByKey = (
  sections: Array<Pick<CommunityDefinitionSectionInput, "name" | "kinds">>,
) => new Map(sections.map(section => [getCommunitySectionNameKey(section.name), section]))

const getCurrentOriginalNameKey = (
  section: KeyedCommunitySectionInput,
  originalSectionsByKey: Map<string, Pick<CommunityDefinitionSectionInput, "name" | "kinds">>,
) => {
  const key = section.originalNameKey || ""

  return key && originalSectionsByKey.has(key) ? key : undefined
}

const getSectionAssignmentMap = (
  sections: KeyedCommunitySectionInput[],
  originalSectionsByKey: Map<string, Pick<CommunityDefinitionSectionInput, "name" | "kinds">>,
) => {
  const assignments = new Map<string, KeyedSectionKindAssignment>()

  for (const section of sections) {
    const originalNameKey = getCurrentOriginalNameKey(section, originalSectionsByKey)

    for (const sectionKind of section.kinds) {
      const kindKey = getCommunitySectionKindKey(sectionKind.kind, sectionKind.subtype)

      assignments.set(kindKey, {
        key: kindKey,
        label: getCommunitySectionKindLabel(sectionKind.kind, sectionKind.subtype),
        sectionName: section.name,
        originalNameKey,
      })
    }
  }

  return assignments
}

export const getSectionLifecycleChanges = ({
  originalSections,
  currentSections,
}: {
  originalSections: Array<Pick<CommunityDefinitionSectionInput, "name" | "kinds">>
  currentSections: KeyedCommunitySectionInput[]
}): SectionLifecycleChange[] => {
  const originalSectionsByKey = getOriginalSectionsByKey(originalSections)
  const currentByOriginalKey = new Map<string, KeyedCommunitySectionInput>()

  for (const currentSection of currentSections) {
    const originalNameKey = getCurrentOriginalNameKey(currentSection, originalSectionsByKey)
    if (originalNameKey && !currentByOriginalKey.has(originalNameKey)) {
      currentByOriginalKey.set(originalNameKey, currentSection)
    }
  }

  const changes: SectionLifecycleChange[] = []
  const removedSectionKeys = new Set<string>()

  for (const originalSection of originalSections) {
    const originalNameKey = getCommunitySectionNameKey(originalSection.name)
    const currentSection = currentByOriginalKey.get(originalNameKey)
    const newSectionName = currentSection?.name.trim() || ""

    if (
      currentSection &&
      newSectionName &&
      getCommunitySectionNameKey(newSectionName) !== originalNameKey
    ) {
      changes.push({
        type: "rename",
        oldSectionName: originalSection.name,
        newSectionName,
      })
    }
  }

  for (const originalSection of originalSections) {
    const originalNameKey = getCommunitySectionNameKey(originalSection.name)
    if (currentByOriginalKey.has(originalNameKey)) continue

    removedSectionKeys.add(originalNameKey)
    changes.push({type: "remove", oldSectionName: originalSection.name})
  }

  const originalAssignments = getSectionAssignmentMap(
    originalSections.map(section => ({
      ...section,
      originalNameKey: getCommunitySectionNameKey(section.name),
    })),
    originalSectionsByKey,
  )
  const currentAssignments = getSectionAssignmentMap(currentSections, originalSectionsByKey)

  for (const [kindKey, originalAssignment] of originalAssignments) {
    const currentAssignment = currentAssignments.get(kindKey)
    const originalNameKey = originalAssignment.originalNameKey || ""

    if (!currentAssignment) {
      if (!removedSectionKeys.has(originalNameKey)) {
        changes.push({
          type: "kind-remove",
          kindKey,
          kindLabel: originalAssignment.label,
          oldSectionName: originalAssignment.sectionName,
        })
      }
      continue
    }

    if (currentAssignment.originalNameKey === originalNameKey) continue

    changes.push({
      type: "move",
      kindKey,
      kindLabel: originalAssignment.label,
      oldSectionName: originalAssignment.sectionName,
      newSectionName: currentAssignment.sectionName,
    })
  }

  return changes
}
