import type {Component} from "svelte"
import {writable} from "svelte/store"
import {randomId} from "@welshman/lib"
import {copyToClipboard} from "@lib/html"

export type ToastParams = {
  message?: string
  timeout?: number
  theme?: "error" | "success" | "info" | "warning"
  children?: {
    component: Component<any>
    props: Record<string, any>
  }
  action?: {
    message: string
    onclick: () => void
  }
}

export type Toast = ToastParams & {
  id: string
}

export const toast = writable<Toast | null>(null)

export const pushToast = (params: ToastParams) => {
  const id = randomId()

  toast.set({id, ...params})

  const timeout = params.timeout ?? 5000

  if (timeout > 0) {
    setTimeout(() => popToast(id), timeout)
  }

  return id
}

export const popToast = (id: string) => toast.update($t => ($t?.id === id ? null : $t))

export const clip = (value: string) => {
  copyToClipboard(value)
  pushToast({message: "Copied to clipboard!"})
}
