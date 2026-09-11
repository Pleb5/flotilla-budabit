import {nip19} from "nostr-tools"
import {BASE_TIMESTAMP, TEST_PUBKEYS, signTestEvent} from "./events"

export const articleRelay = "wss://longform.example/"
export const articleImage = "http://localhost:1847/tests/e2e/fixtures/article-cover.svg"
export const articleAddress = nip19.naddrEncode({
  kind: 30023,
  pubkey: TEST_PUBKEYS.alice,
  identifier: "longform-fixture",
  relays: [articleRelay],
})
export const article = signTestEvent({
  kind: 30023,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
  tags: [
    ["d", "longform-fixture"],
    ["title", "Building useful things together"],
    ["summary", "A practical guide to sharing knowledge on an open network."],
    ["published_at", String(BASE_TIMESTAMP - 86400)],
    ["image", articleImage],
  ],
  content: `## Build in the open

Good tools make **collaboration** easier and keep *knowledge* accessible.

### Practical steps

- Share what you learn.
- Make small improvements.
- Leave useful documentation.

> The best starting point is something people can use.

| Format | Purpose |
| --- | --- |
| Notes | Short updates |
| Articles | Detailed explanations |

\`\`\`typescript
const message = "hello, Nostr";
console.log(message);
\`\`\`

[Read the documentation](https://example.com/docs)

![A diagram for this article](${articleImage})

<p onclick="window.__longformXss = true">Safe text from HTML.</p>
<script>window.__longformXss = true</script>
[Unsafe link](javascript:window.__longformXss=true)

${"Open standards let people share ideas without depending on a single application. ".repeat(18)}

## Beyond the preview

This final section is rendered without a generic Show more button.

### Article reference

nostr:${articleAddress}
`,
})
export const articleNevent = nip19.neventEncode({
  id: article.id,
  author: article.pubkey,
  kind: article.kind,
  relays: [articleRelay],
})
export const articleProfile = signTestEvent({
  kind: 0,
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP,
  tags: [],
  content: JSON.stringify({name: "Alice", display_name: "Alice (test author)"}),
})
export const draft = signTestEvent({
  kind: 30024,
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP,
  tags: [["d", "draft-fixture"]],
  content: "## Draft section\n\nA **work in progress**.",
})
