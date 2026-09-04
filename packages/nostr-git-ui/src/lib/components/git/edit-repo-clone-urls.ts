const isDirectNostrCloneUrl = (value: string): boolean => /^nostr:/i.test(value.trim());

const uniqueNonEmpty = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));

export function getEditableRepoCloneUrls(values: string[]): string[] {
  return uniqueNonEmpty(values).filter((value) => !isDirectNostrCloneUrl(value));
}

export function mergePreservedNostrCloneUrls(
  editableValues: string[],
  currentValues: string[]
): string[] {
  const editable = getEditableRepoCloneUrls(editableValues);
  const preserved = uniqueNonEmpty(currentValues).filter(isDirectNostrCloneUrl);
  return [...editable, ...preserved];
}
