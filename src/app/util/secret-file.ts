export const SECRET_FILE_ACCEPT = ".txt,.text,.md,.json,text/plain,text/markdown,application/json"
export const SECRET_FILE_MAX_BYTES = 1024 * 1024
export const SECRET_FILE_NAME_PATTERN = /\.(txt|text|md|json)$/i

export const isSupportedSecretFile = (file: File) =>
  !file.type ||
  file.type.startsWith("text/") ||
  file.type === "application/json" ||
  SECRET_FILE_NAME_PATTERN.test(file.name)

export const cleanupBackupCopy = (copy: string) =>
  copy
    .replace(/\n\s*\n\s*/g, "NEWLINE")
    .replace(/\s+/g, " ")
    .replace(/NEWLINE/g, "\n\n")
    .trim()
