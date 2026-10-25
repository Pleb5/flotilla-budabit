import type {CommunityDefinition} from "./community-protocol"
import type {CommunityAdmissionForm} from "./community-forms"

export type CommunityJoinEntry =
  | {status: "absent"}
  | {status: "invalid"}
  | {status: "selected"; sectionName: string}

/** Optional navigation metadata. Invalid metadata never changes base authority. */
export const readCommunityJoinEntry = (tags: string[][]): CommunityJoinEntry => {
  let sectionName = ""
  const entries: Array<{tag: string[]; sectionName: string}> = []
  for (const tag of tags) {
    if (tag[0] === "content") sectionName = tag[1] || ""
    if (tag[0] === "join") entries.push({tag, sectionName})
  }
  if (!entries.length) return {status: "absent"}
  if (entries.length !== 1 || entries[0].tag.length !== 1 || !entries[0].sectionName)
    return {status: "invalid"}
  return {status: "selected", sectionName: entries[0].sectionName}
}

/** Apply after extension-preserving merges, never before (which duplicates markers). */
export const setCommunityJoinEntry = (tags: string[][], sectionName: string | null) => {
  if (sectionName !== null && !tags.some(t => t[0] === "content" && t[1] === sectionName))
    throw new Error("Choose an existing section for new members to join.")
  return tags.flatMap(tag =>
    tag[0] === "join"
      ? []
      : tag[0] === "content" && tag[1] === sectionName
        ? [[...tag], ["join"]]
        : [[...tag]],
  )
}

export const usableJoinForm = (
  form: CommunityAdmissionForm | undefined,
): form is CommunityAdmissionForm => {
  if (!form || !form.fieldOrder.length || new Set(form.fieldOrder).size !== form.fieldOrder.length)
    return false
  let inputs = 0
  for (const id of form.fieldOrder) {
    const field = form.fields[id]
    if (!field || !["text", "option", "label"].includes(field.type)) return false
    if (field.type === "label") continue
    inputs++
    if (
      field.type === "option" &&
      (!field.options.length || new Set(field.options.map(o => o.id)).size !== field.options.length)
    )
      return false
    if (field.settings.prerequisites) return false
  }
  return inputs > 0
}

export const joinSetupMessage = (
  definition: CommunityDefinition,
  forms: Record<string, CommunityAdmissionForm>,
) => {
  const entry = readCommunityJoinEntry(definition.event.tags)
  if (entry.status === "absent") return "Choose a default section for new members to join."
  if (entry.status === "invalid") return "Choose one default section for new members to join."
  if (!usableJoinForm(forms[entry.sectionName]))
    return `Set up an application form for ${entry.sectionName} so new members can join.`
  return ""
}
