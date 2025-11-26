/**
 * Component mounting logic for markdown placeholders
 */

import {mount} from "svelte"
import type {TrustedEvent} from "@welshman/util"
import Profile from "@app/components/Profile.svelte"
import ProfileLink from "@app/components/ProfileLink.svelte"
import ContentLinkBlock from "@app/components/ContentLinkBlock.svelte"
import ContentQuote from "@app/components/ContentQuote.svelte"

export interface MountedComponent {
  target: Element
  component: any
}

export interface ComponentMounterOptions {
  event?: TrustedEvent
  url?: string
  minimalQuote?: boolean
  depth?: number
  hideMediaAtDepth?: number
}

/**
 * Mounts all placeholder components in the container
 */
export function mountPlaceholderComponents(
  container: HTMLElement,
  options: ComponentMounterOptions,
): MountedComponent[] {
  const mountedComponents: MountedComponent[] = []

  mountProfilePlaceholders(container, mountedComponents)
  mountLinkBlockPlaceholders(container, options, mountedComponents)
  mountQuotePlaceholders(container, options, mountedComponents)

  return mountedComponents
}

/**
 * Mounts profile placeholder components
 */
function mountProfilePlaceholders(
  container: HTMLElement,
  mountedComponents: MountedComponent[],
): void {
  const profilePlaceholders = container.querySelectorAll(".nostr-profile-placeholder")
  profilePlaceholders.forEach(placeholder => {
    const pubkey = placeholder.getAttribute("data-pubkey")
    const profileUrl = placeholder.getAttribute("data-url")

    if (pubkey) {
      try {
        const wrapper = document.createElement("div")
        wrapper.className = "inline-flex items-center gap-1 align-middle"
        wrapper.style.verticalAlign = "middle"

        const avatarContainer = document.createElement("span")
        const linkContainer = document.createElement("span")

        wrapper.appendChild(avatarContainer)
        wrapper.appendChild(linkContainer)

        placeholder.replaceWith(wrapper)

        const profileComponent = mount(Profile, {
          target: avatarContainer,
          props: {
            pubkey,
            url: profileUrl || undefined,
            avatarSize: 6,
            hideDetails: true,
          },
        })

        const linkComponent = mount(ProfileLink, {
          target: linkContainer,
          props: {
            pubkey,
            url: profileUrl || undefined,
          },
        })

        mountedComponents.push(
          {target: avatarContainer, component: profileComponent},
          {target: linkContainer, component: linkComponent},
        )
      } catch (e) {
        console.error("Failed to mount Profile components:", e)
      }
    }
  })
}

/**
 * Mounts link block placeholder components
 */
function mountLinkBlockPlaceholders(
  container: HTMLElement,
  options: ComponentMounterOptions,
  mountedComponents: MountedComponent[],
): void {
  const {event} = options
  if (!event) return

  const linkBlockPlaceholders = container.querySelectorAll(".markdown-link-block-placeholder")
  linkBlockPlaceholders.forEach(placeholder => {
    const linkUrl = placeholder.getAttribute("data-url")
    const eventId = placeholder.getAttribute("data-event-id")

    if (linkUrl && eventId && event.id === eventId) {
      try {
        const containerElement = document.createElement("div")
        placeholder.replaceWith(containerElement)

        const linkBlockComponent = mount(ContentLinkBlock, {
          target: containerElement,
          props: {
            value: {url: new URL(linkUrl)},
            event,
          },
        })
        mountedComponents.push({target: containerElement, component: linkBlockComponent})
      } catch (e) {
        console.error("Failed to mount ContentLinkBlock:", e)
        // Fallback to regular link
        const link = document.createElement("a")
        link.href = linkUrl
        link.textContent = linkUrl
        link.className = "link"
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        placeholder.replaceWith(link)
      }
    }
  })
}

/**
 * Mounts quote placeholder components
 */
function mountQuotePlaceholders(
  container: HTMLElement,
  options: ComponentMounterOptions,
  mountedComponents: MountedComponent[],
): void {
  const {event, url, minimalQuote = false, depth = 0, hideMediaAtDepth = 1} = options
  if (!event) return

  const quotePlaceholders = container.querySelectorAll(".markdown-quote-placeholder")
  quotePlaceholders.forEach(placeholder => {
    const quoteType = placeholder.getAttribute("data-type")
    const eventId = placeholder.getAttribute("data-event-id")
    const quoteUrl = placeholder.getAttribute("data-url") || url
    const minimal = placeholder.getAttribute("data-minimal") === "true"
    const quoteDepth = parseInt(placeholder.getAttribute("data-depth") || "0")
    const hideMedia = parseInt(placeholder.getAttribute("data-hide-media") || "1")

    if (eventId && event.id === eventId) {
      try {
        let quoteValue: any = null

        if (quoteType === "note" || quoteType === "nevent") {
          const id = placeholder.getAttribute("data-id")
          if (!id) {
            console.error(`Missing id for ${quoteType} quote`)
            return
          }
          const relaysAttr = placeholder.getAttribute("data-relays") || "[]"
          let relays: string[] = []
          try {
            relays = JSON.parse(relaysAttr.replace(/&quot;/g, '"'))
          } catch (e) {
            console.error(`Failed to parse relays for ${quoteType}:`, e)
            relays = []
          }
          quoteValue = {id, relays}
        } else if (quoteType === "naddr") {
          const kindAttr = placeholder.getAttribute("data-kind")
          const pubkeyAttr = placeholder.getAttribute("data-pubkey")
          const identifierAttr = placeholder.getAttribute("data-identifier")

          if (!kindAttr || !pubkeyAttr || identifierAttr === null) {
            console.error("Missing required fields for naddr quote", {
              kindAttr,
              pubkeyAttr,
              identifierAttr,
            })
            return
          }

          const kind = parseInt(kindAttr)
          if (isNaN(kind)) {
            console.error("Invalid kind for naddr quote:", kindAttr)
            return
          }

          const relaysAttr = placeholder.getAttribute("data-relays") || "[]"
          let relays: string[] = []
          try {
            relays = JSON.parse(relaysAttr.replace(/&quot;/g, '"'))
          } catch (e) {
            console.error("Failed to parse relays for naddr:", e)
            relays = []
          }
          quoteValue = {kind, pubkey: pubkeyAttr, identifier: identifierAttr, relays}
        }

        if (quoteValue) {
          const containerElement = document.createElement("div")
          placeholder.replaceWith(containerElement)

          const quoteComponent = mount(ContentQuote, {
            target: containerElement,
            props: {
              value: quoteValue,
              event,
              url: quoteUrl || undefined,
              minimal: minimal || minimalQuote,
              depth: quoteDepth || depth,
              hideMediaAtDepth: hideMedia || hideMediaAtDepth,
            },
          })
          mountedComponents.push({target: containerElement, component: quoteComponent})
        }
      } catch (e) {
        console.error("Failed to mount ContentQuote:", e, {
          quoteType,
          eventId,
          placeholder: placeholder.outerHTML,
        })
      }
    }
  })
}

/**
 * Cleans up mounted components
 */
export function cleanupMountedComponents(mountedComponents: MountedComponent[]): void {
  mountedComponents.forEach(({component}) => {
    try {
      component.$destroy?.()
    } catch (e) {
      // Ignore errors during cleanup
    }
  })
}

