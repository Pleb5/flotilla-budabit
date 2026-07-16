import {fromCsv} from "@app/core/state"

export const GIT_RELAYS = fromCsv(import.meta.env.VITE_GIT_RELAYS)
