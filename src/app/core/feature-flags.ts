export const CASHU_WALLET_ENABLED = import.meta.env.VITE_CASHU_WALLET_ENABLED === "1"

export const PERFORMANCE_DIAGNOSTICS_ENABLED = import.meta.env.VITE_PERFORMANCE_DIAGNOSTICS === "1"

export const DIAGNOSTICS_ENABLED = import.meta.env.VITE_DIAGNOSTICS === "1"

// "auto" (nsite builds) applies a fully prepared update before the app renders at the next
// startup, without the Reload prompt. Any other value keeps the prompt-based update flow.
export const APP_UPDATE_MODE: "auto" | "prompt" =
  import.meta.env.VITE_APP_UPDATE_MODE === "auto" ? "auto" : "prompt"

// Retired history importer; independent of New Repo's public repository onramp.
export const IMPORT_REPO_ENABLED = false
