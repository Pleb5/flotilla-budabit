export type UiErrorTheme = "error" | "warning";

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

/**
 * Convert an unknown error (including @nostr-git/core/errors) into a user-friendly message.
 * This is UI-focused: it favors clarity and consistency over exposing internal details.
 */
export function toUserMessage(
  err: unknown,
  fallback: string = "Operation failed"
): { message: string; theme?: UiErrorTheme } {
  const e = asError(err);
  const name = String((e as any).name || "Error");
  const msg = (e.message || "").trim();
  const lower = msg.toLowerCase();

  // Typed errors (preferred)
  if (name === "FatalError") {
    return { message: msg || fallback, theme: "error" };
  }
  if (name === "RetriableError") {
    return { message: msg || "Temporary failure. Please try again.", theme: "warning" };
  }
  if (name === "UserActionableError") {
    return { message: msg || fallback, theme: "error" };
  }

  // Heuristics for common cases (covers factory errors when name is not stable)
  const looksPermission =
    /permission denied|not authorized|forbidden|access denied|insufficient permissions/.test(lower) ||
    /permissiondenied/i.test(name);

  if (looksPermission) {
    return { message: msg || "You don\u0027t have permission to perform this action.", theme: "error" };
  }

  const looksAuth =
    /authentication required|auth required|unauthorized|token|login|sign in|401|403/.test(lower) ||
    /authrequired/i.test(name);

  if (looksAuth) {
    return { message: msg || "Authentication is required to perform this action.", theme: "error" };
  }

  const looksTimeout = /timed out|timeout/.test(lower);
  if (looksTimeout) {
    return { message: msg || "Request timed out. Please try again.", theme: "warning" };
  }

  const looksNetwork =
    /failed to fetch|network error|networkerror|econnreset|enotfound|eai_again/.test(lower);
  if (looksNetwork) {
    return { message: msg || "Network error. Please check your connection and retry.", theme: "warning" };
  }

  return { message: msg || fallback, theme: "error" };
}