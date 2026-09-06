export interface PRReviewUrlAttempt {
  url: string
  success: boolean
  error?: string
  errorCode?: string
  status?: number
}

export interface ClassifiedPRReviewFailure {
  url: string
  error: string
  errorCode?: string
  status?: number
  kind: string
}

export interface PRReviewFallbackEvidence {
  targetObservation?: {
    operation: "diff"
    failures: ClassifiedPRReviewFailure[]
    activeFallbackUrl?: string
  }
  targetEndpointFailures: ClassifiedPRReviewFailure[]
  usedTargetUrl?: string
  sourceMessage?: string
}

type FailureClassifier = (
  error: string,
  status?: number,
  errorCode?: string,
) => {kind: string; endpointIssue: boolean}

export function buildPRReviewFallbackEvidence(params: {
  result: {
    targetAttempts?: PRReviewUrlAttempt[]
    sourceAttempts?: PRReviewUrlAttempt[]
    usedTargetCloneUrl?: string
    usedCloneUrl?: string
  } | null
  targetPrimaryUrl?: string
  sourcePrimaryUrl?: string
  classify: FailureClassifier
}): PRReviewFallbackEvidence {
  const targetFailures = (params.result?.targetAttempts || [])
    .filter(attempt => !attempt.success)
    .map(attempt => classifyFailure(attempt, params.classify))
  const usedTargetUrl = cleanUrl(params.result?.usedTargetCloneUrl)
  const activeTargetFallbackUrl =
    usedTargetUrl && usedTargetUrl !== cleanUrl(params.targetPrimaryUrl) ? usedTargetUrl : undefined
  const targetObservation =
    targetFailures.length > 0 || activeTargetFallbackUrl
      ? {
          operation: "diff" as const,
          failures: targetFailures,
          ...(activeTargetFallbackUrl ? {activeFallbackUrl: activeTargetFallbackUrl} : {}),
        }
      : undefined

  const sourceFailures = (params.result?.sourceAttempts || []).filter(attempt => !attempt.success)
  const usedSourceUrl = cleanUrl(params.result?.usedCloneUrl)
  const sourceFallback =
    Boolean(usedSourceUrl) && usedSourceUrl !== cleanUrl(params.sourcePrimaryUrl)
  const failedHosts = Array.from(
    new Set(sourceFailures.map(attempt => formatCloneHost(attempt.url)).filter(Boolean)),
  )
  const sourceMessage =
    sourceFailures.length > 0 || sourceFallback
      ? sourceFallback
        ? `PR source read${failedHosts.length ? ` could not complete on ${failedHosts.join(", ")};` : ""} using fallback ${formatCloneHost(usedSourceUrl)}.`
        : `PR source read encountered a remote failure${failedHosts.length ? ` on ${failedHosts.join(", ")}` : ""}.`
      : undefined

  return {
    ...(targetObservation ? {targetObservation} : {}),
    targetEndpointFailures: targetFailures.filter(
      failure => params.classify(failure.error, failure.status, failure.errorCode).endpointIssue,
    ),
    ...(usedTargetUrl ? {usedTargetUrl} : {}),
    ...(sourceMessage ? {sourceMessage} : {}),
  }
}

function classifyFailure(
  attempt: PRReviewUrlAttempt,
  classify: FailureClassifier,
): ClassifiedPRReviewFailure {
  const error = String(attempt.error || "Unknown error")
  const classification = classify(error, attempt.status, attempt.errorCode)
  return {
    url: attempt.url,
    error,
    errorCode: attempt.errorCode,
    status: attempt.status,
    kind: classification.kind,
  }
}

function cleanUrl(url: unknown): string {
  return String(url || "").trim()
}

function formatCloneHost(url: unknown): string {
  try {
    return new URL(cleanUrl(url)).host
  } catch {
    return cleanUrl(url)
  }
}
