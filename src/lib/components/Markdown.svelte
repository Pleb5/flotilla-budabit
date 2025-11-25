<style>
  .markdown {
    @apply text-base leading-relaxed;
  }

  .markdown :global(h1) {
    @apply mb-4 mt-6 text-3xl font-bold;
  }

  .markdown :global(h2) {
    @apply mb-3 mt-5 text-2xl font-bold;
  }

  .markdown :global(h3) {
    @apply mb-2 mt-4 text-xl font-semibold;
  }

  .markdown :global(h4) {
    @apply mb-2 mt-3 text-lg font-semibold;
  }

  .markdown :global(h5) {
    @apply mb-1 mt-2 text-base font-semibold;
  }

  .markdown :global(h6) {
    @apply mb-1 mt-2 text-sm font-semibold;
  }

  .markdown :global(p) {
    @apply my-3;
  }

  .markdown :global(a) {
    @apply text-primary hover:underline;
  }

  .markdown :global(strong) {
    @apply font-bold;
  }

  .markdown :global(em) {
    @apply italic;
  }

  .markdown :global(code) {
    @apply rounded bg-base-200 px-1.5 py-0.5 font-mono text-sm;
    color: hsl(var(--bc) / 0.9);
  }

  .markdown :global(pre) {
    @apply my-4 overflow-x-auto rounded-lg border border-base-300 bg-base-300/50 p-4;
    box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);
  }

  .markdown :global(pre code) {
    @apply bg-transparent p-0 text-sm;
    font-family: "Menlo", "Monaco", "Courier New", monospace;
    line-height: 1.5;
  }

  .markdown :global(blockquote) {
    @apply my-4 border-l-4 border-primary pl-4 italic;
  }

  .markdown :global(ul) {
    @apply my-3 list-disc pl-6;
  }

  .markdown :global(ol) {
    @apply my-3 list-decimal pl-6;
  }

  .markdown :global(li) {
    @apply my-1;
  }

  .markdown :global(hr) {
    @apply my-6 border-t border-base-300;
  }

  /* Table wrapper for horizontal scroll on mobile */
  .markdown :global(table) {
    @apply my-4 w-full border-collapse;
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  @media (min-width: 768px) {
    .markdown :global(table) {
      display: table;
    }
  }

  .markdown :global(th) {
    @apply border border-base-300 bg-base-200 p-2 font-semibold;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .markdown :global(th) {
      white-space: normal;
    }
  }

  .markdown :global(td) {
    @apply border border-base-300 p-2;
    white-space: nowrap;
  }

  @media (min-width: 768px) {
    .markdown :global(td) {
      white-space: normal;
    }
  }

  .markdown :global(img) {
    @apply my-4 h-auto max-w-full;
  }

  /* Profile mentions - ensure proper vertical alignment */
  .markdown :global(.inline-flex) {
    vertical-align: middle;
  }
</style>

<script lang="ts">
  import {marked, type Token, type Tokens, type TokenizerAndRendererExtension} from "marked"
  import DOMPurify from "dompurify"
  import {nip19, nip05} from "nostr-tools"
  import hljs from "highlight.js"
  import "highlight.js/styles/github-dark.css"
  import {profilesByPubkey, loadProfile} from "@welshman/app"
  import {getContext, mount} from "svelte"
  import {REPO_RELAYS_KEY} from "@lib/budabit"
  import {normalizeRelayUrl} from "@welshman/util"
  import Profile from "@app/components/Profile.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"

  interface Props {
    content?: string
    relays?: string[]
  }

  let {content = "", relays}: Props = $props()

  let sanitizedContent = $state("")
  let containerElement: HTMLDivElement | undefined = $state()
  let mountedComponents: Array<{target: Element; component: any}> = []

  // Get relays from context if not provided
  const contextRelays = getContext<string[]>(REPO_RELAYS_KEY)
  const defaultRelays = $derived.by(() => {
    if (relays && relays.length > 0) {
      return relays.map((u: string) => normalizeRelayUrl(u)).filter(Boolean) as string[]
    }
    if (contextRelays && contextRelays.length > 0) {
      return contextRelays.map((u: string) => normalizeRelayUrl(u)).filter(Boolean) as string[]
    }
    return []
  })

  // Helper function to shorten URLs
  function shortenUrl(url: string, text?: string): string {
    // If custom text is provided and it's not the same as URL, use it
    if (text && text !== url) {
      return text
    }

    try {
      const urlObj = new URL(url)
      const domain = urlObj.hostname.replace("www.", "")
      const pathname = urlObj.pathname

      if (pathname && pathname !== "/") {
        const pathParts = pathname.split("/").filter(Boolean)
        if (pathParts.length > 0) {
          // Show first part of path, truncate if too long
          const firstPath = pathParts[0]
          if (firstPath.length > 20) {
            return `${domain}/${firstPath.substring(0, 15)}...`
          }
          return `${domain}/${firstPath}${pathParts.length > 1 ? "/..." : ""}`
        }
      }
      return domain
    } catch (e) {
      // Fallback for invalid URLs
      return url.length > 40 ? `${url.substring(0, 20)}...${url.substring(url.length - 15)}` : url
    }
  }

  // Helper function to shorten Nostr URIs
  function shortenNostrUri(tagType: string, content: string): string {
    const fullUri = `${tagType}${content}`
    // Show first 8 and last 8 characters
    return `${fullUri.slice(0, 8)}:${fullUri.slice(-8)}`
  }

  // Resolve NIP-05 identifier to pubkey using nostr-tools
  async function resolveNip05(identifier: string): Promise<string | null> {
    if (!identifier.includes("@")) {
      return null
    }

    try {
      const profile = await nip05.queryProfile(identifier)
      return profile?.pubkey || null
    } catch (e) {
      console.error(`Failed to resolve NIP-05 ${identifier}:`, e)
      return null
    }
  }

  // Get profile for a pubkey
  const getPub = async (token: Token) => {
    if (token.type === "nostr") {
      console.log("[markdown walkTokens getPub]", token)
      const fullId = token.fullId
      if (!fullId) return

      try {
        const result: any = nip19.decode(fullId)
        let pubkey: string | undefined

        console.log("[markdown walkTokens getPub result]", result, pubkey)

        // Narrow types properly
        if (result.type === "nprofile") {
          pubkey = result.data.pubkey
        } else if (result.type === "npub") {
          pubkey = result.data
        }

        if (!pubkey) return

        token.pubkey = pubkey

        // Get or load profile
        let profile = $profilesByPubkey.get(pubkey)
        if (!profile && defaultRelays.length > 0) {
          await loadProfile(pubkey, defaultRelays)
          profile = $profilesByPubkey.get(pubkey)
        }

        console.log("[markdown walkTokens getPub profile]", profile)

        if (profile) {
          token.userName = profile.name || profile.display_name || null
        }
      } catch (e) {
        console.error("Failed to decode nostr token:", e, fullId)
      }
    } else if (token.type === "email") {
      try {
        const pubkey = await resolveNip05(token.text)
        if (pubkey) {
          token.isNip05 = true
          token.tagType = "npub"
          token.content = pubkey
          token.pubkey = pubkey

          // Get or load profile
          let profile = $profilesByPubkey.get(pubkey)
          if (!profile && defaultRelays.length > 0) {
            await loadProfile(pubkey, defaultRelays)
            profile = $profilesByPubkey.get(pubkey)
          }

          if (profile) {
            token.userName = profile.name || profile.display_name || token.text
          } else {
            token.userName = token.text
          }
        } else {
          token.isNip05 = false
        }
      } catch (e) {
        console.error(`Failed to fetch NIP-05 user for ${token.text}:`, e)
        token.isNip05 = false
      }
    }
  }

  // Bech32 characters are alphanumeric excluding '1', 'b', 'i', 'o'
  const nostrRegex = /^(nostr:)?(n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,})/
  const nostrTokenizer: TokenizerAndRendererExtension = {
    name: "nostr",
    level: "inline",
    start(src: string) {
      const match = src.match(/(nostr:)?n(?:event|ote|pub|profile|addr)1/)
      return match ? match.index! : -1
    },
    tokenizer(src: string) {
      const match = nostrRegex.exec(src)
      if (match) {
        const [fullMatch, prefix, fullId] = match
        console.log("[markdown tokenizer match]", match)
        // fullId is the complete npub1..., note1..., etc.
        return {
          type: "nostr",
          raw: fullMatch,
          text: fullMatch,
          fullId: fullId,
          prefix: prefix || "",
          userName: null,
          tokens: [],
        }
      }
    },
    renderer(token: Tokens.Generic) {
      const {fullId, userName, pubkey} = token
      let url = `/${fullId}`
      let external = false

      try {
        const decoded = nip19.decode(fullId)

        if (decoded.type === "nevent" || decoded.type === "note") {
          url = `https://coracle.social/notes/${fullId}`
          external = true
        } else if (decoded.type === "nprofile") {
          external = true
          url = `https://coracle.social/people/${fullId}`

          // For npub and nprofile, create a placeholder that we'll replace with a Svelte component
          if (pubkey) {
            return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
          }
        } else if (decoded.type === "npub") {
          url = `/people/${fullId}`

          // For npub and nprofile, create a placeholder that we'll replace with a Svelte component
          if (pubkey) {
            return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
          }
        } else if (decoded.type === "naddr") {
          const data = decoded.data
          // For git repos, use internal routing
          if (data.kind === 30617) {
            url = `/${fullId}`
          } else {
            external = true
            url = `https://coracle.social/${fullId}`
          }
        }
      } catch (err) {
        console.error("Failed to decode in renderer:", err, fullId)
        // If decoding fails, use default URL
        url = `/${fullId}`
      }

      // For other types, render as simple link
      const linkText = userName ? `@${userName}` : shortenNostrUri("", fullId)
      const externalAttributes = external ? 'target="_blank" rel="noopener noreferrer"' : ""
      return `<a href="${url}" ${externalAttributes} 
                    class="link" title="${fullId}">${linkText}
                    </a>`
    },
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+/
  const emailTokenizer: TokenizerAndRendererExtension = {
    name: "email",
    level: "inline",
    start(src: string) {
      const match = src.match(emailRegex)
      return match ? match.index! : -1
    },
    tokenizer(src: string) {
      const match = emailRegex.exec(src)
      if (match) {
        const [fullMatch] = match
        return {
          type: "email",
          raw: fullMatch,
          text: fullMatch,
          href: `mailto:${fullMatch}`,
          isNip05: false,
          tokens: [],
        }
      }
    },
    renderer(token: Tokens.Generic) {
      if (token.isNip05) {
        // Render as Nostr link - create placeholder for Svelte component
        const {pubkey} = token
        if (pubkey) {
          return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
        }
        return `<a href="mailto:${token.text}" class="link">${token.text}</a>`
      } else {
        return `<a href="${token.href}" class="link">${token.text}</a>`
      }
    },
  }

  marked.use({
    extensions: [nostrTokenizer, emailTokenizer],
    async: true,
    breaks: true,
    walkTokens: getPub,
    renderer: {
      image() {
        return ""
      },
      link(token) {
        const {href, text} = token

        // Check if href is a nostr URI
        const nostrMatch = href.match(
          /^(nostr:)?(n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,})$/,
        )
        if (nostrMatch) {
          const fullId = nostrMatch[2]

          try {
            const result: any = nip19.decode(fullId)

            // For npub and nprofile, create placeholder for Profile component
            if (result.type === "nprofile" || result.type === "npub") {
              let pubkey = ""
              if (result.type === "nprofile") {
                pubkey = result.data.pubkey
              } else if (result.type === "npub") {
                pubkey = result.data
              }

              if (pubkey) {
                return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
              }
            }

            // For other nostr types, create regular links
            let url = `/${fullId}`
            let external = false

            if (result.type === "nevent" || result.type === "note") {
              url = `https://coracle.social/notes/${fullId}`
              external = true
            } else if (result.type === "naddr") {
              const data = result.data
              if (data.kind === 30617) {
                url = `/${fullId}`
              } else {
                external = true
                url = `https://coracle.social/${fullId}`
              }
            }

            const externalAttributes = external ? 'target="_blank" rel="noopener noreferrer"' : ""
            const linkText = text || fullId
            return `<a href="${url}" ${externalAttributes} class="link" title="${fullId}">${linkText}</a>`
          } catch (err) {
            console.error("Failed to decode nostr link:", err, fullId)
          }
        }

        // Regular URL handling
        const displayText = shortenUrl(href, text)
        return `<a href="${href}" class="link" title="${href}" target="_blank" rel="noopener noreferrer">${displayText}</a>`
      },
      list(token) {
        const listItems = token.items
          .map(item => {
            const itemContent = this.parser.parseInline(item.tokens)
            return `<li>${itemContent}</li>`
          })
          .join("\n")

        const listClass = token.ordered ? "list-decimal list-inside" : "list-disc list-inside"

        return token.ordered
          ? `<ol class="${listClass}">${listItems}</ol>`
          : `<ul class="${listClass}">${listItems}</ul>`
      },
      code(token) {
        const validLang = token.lang || "plaintext"
        const highlightedCode = hljs.highlight(token.text, {
          language: validLang,
        }).value

        return `
                    <pre class="hljs"><code class="language-${validLang}">${highlightedCode}</code></pre>
                `
      },
    },
  })

  $effect(() => {
    if (content) {
      ;(async () => {
        const parsed = await marked(content)
        sanitizedContent = DOMPurify.sanitize(parsed, {
          ADD_ATTR: ["target", "title", "data-pubkey", "data-url"],
          ADD_TAGS: ["span"],
        })
      })()
    } else {
      sanitizedContent = ""
    }
  })

  // Mount ProfileLink components after content is rendered
  $effect(() => {
    if (containerElement && sanitizedContent) {
      // Clean up previously mounted components
      mountedComponents.forEach(({component}) => {
        try {
          component.$destroy?.()
        } catch (e) {
          // Ignore errors during cleanup
        }
      })
      mountedComponents = []

      // Find all profile placeholders and mount components
      setTimeout(() => {
        if (!containerElement) return

        const placeholders = containerElement.querySelectorAll(".nostr-profile-placeholder")
        placeholders.forEach(placeholder => {
          const pubkey = placeholder.getAttribute("data-pubkey")
          const url = placeholder.getAttribute("data-url")

          if (pubkey) {
            try {
              // Create a wrapper div to hold both components
              const wrapper = document.createElement("div")
              wrapper.className = "inline-flex items-center gap-1 align-middle"
              wrapper.style.verticalAlign = "middle"

              // Create containers for each component
              const avatarContainer = document.createElement("span")
              const linkContainer = document.createElement("span")

              wrapper.appendChild(avatarContainer)
              wrapper.appendChild(linkContainer)

              // Replace placeholder with wrapper
              placeholder.replaceWith(wrapper)

              // Mount Profile component (avatar only, hideDetails=true)
              const profileComponent = mount(Profile, {
                target: avatarContainer,
                props: {
                  pubkey,
                  url: url || undefined,
                  avatarSize: 6,
                  hideDetails: true,
                },
              })

              // Mount ProfileLink component (name only)
              const linkComponent = mount(ProfileLink, {
                target: linkContainer,
                props: {
                  pubkey,
                  url: url || undefined,
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
      }, 0)
    }

    return () => {
      // Cleanup on component unmount
      mountedComponents.forEach(({component}) => {
        try {
          component.$destroy?.()
        } catch (e) {
          // Ignore errors
        }
      })
    }
  })
</script>

<div class="markdown max-w-full overflow-hidden" bind:this={containerElement}>
  {@html sanitizedContent}
</div>
