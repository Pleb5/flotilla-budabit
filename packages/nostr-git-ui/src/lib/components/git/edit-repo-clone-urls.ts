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
  const current = uniqueNonEmpty(currentValues);
  const merged: string[] = [];
  let editableIndex = 0;

  for (const value of current) {
    if (isDirectNostrCloneUrl(value)) {
      merged.push(value);
    } else if (editableIndex < editable.length) {
      merged.push(editable[editableIndex++]);
    }
  }

  merged.push(...editable.slice(editableIndex));
  return merged;
}
