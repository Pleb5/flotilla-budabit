import {readable} from "svelte/store"

export const page = readable({
  url: new URL("https://example.com/"),
  params: {},
  data: {},
  form: null,
  route: {id: "/"},
  status: 200,
  error: null,
})

export const navigating = readable(null)
export const updated = readable(false)
