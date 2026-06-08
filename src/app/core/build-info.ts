export const APP_BUILD_HASH = String(import.meta.env.VITE_BUILD_HASH || "")
export const APP_BUILD_ID = String(import.meta.env.VITE_BUILD_ID || APP_BUILD_HASH || "dev")
