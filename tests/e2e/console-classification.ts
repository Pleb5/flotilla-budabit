export type ConsoleMessageRecord = {
  type: string
  text: string
  phase: string
  location?: {
    url?: string
    line?: number
    column?: number
  }
}

export type ConsoleClassification = "blocking" | "suspicious" | "ignorable"

export type ClassifiedConsoleMessage = ConsoleMessageRecord & {
  classification: ConsoleClassification
}

const blockingPatterns = [
  /uncaught/i,
  /unhandled/i,
  /render\s+error/i,
  /failed to render/i,
  /typeerror/i,
  /referenceerror/i,
]

const suspiciousPatterns = [
  /missing/i,
  /not found/i,
  /failed/i,
  /error/i,
  /deprecated/i,
  /timeout/i,
  /network/i,
]

const ignorablePatterns = [
  /download the react devtools/i,
  /chrome-extension/i,
]

export function classifyConsoleMessages(
  messages: ConsoleMessageRecord[],
): ClassifiedConsoleMessage[] {
  const occurrences = new Map<string, number>()

  for (const message of messages) {
    occurrences.set(message.text, (occurrences.get(message.text) ?? 0) + 1)
  }

  return messages.map(message => {
    const text = message.text
    const type = message.type
    const count = occurrences.get(text) ?? 0

    let classification: ConsoleClassification

    if (type === "error") {
      if (count > 1 || blockingPatterns.some(pattern => pattern.test(text))) {
        classification = "blocking"
      } else if (suspiciousPatterns.some(pattern => pattern.test(text))) {
        classification = "suspicious"
      } else if (ignorablePatterns.some(pattern => pattern.test(text))) {
        classification = "ignorable"
      } else {
        classification = "suspicious"
      }
    } else if (type === "warning") {
      if (blockingPatterns.some(pattern => pattern.test(text))) {
        classification = "blocking"
      } else if (suspiciousPatterns.some(pattern => pattern.test(text))) {
        classification = "suspicious"
      } else if (ignorablePatterns.some(pattern => pattern.test(text))) {
        classification = "ignorable"
      } else {
        classification = "suspicious"
      }
    } else {
      if (ignorablePatterns.some(pattern => pattern.test(text))) {
        classification = "ignorable"
      } else if (suspiciousPatterns.some(pattern => pattern.test(text))) {
        classification = "suspicious"
      } else {
        classification = "ignorable"
      }
    }

    return {
      ...message,
      classification,
    }
  })
}
