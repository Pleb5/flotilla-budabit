## Project Overview

Flotilla-Budabit is a Discord-like client built on the Nostr protocol, designed around the concept of "relays as groups/spaces." Developed with SvelteKit 2.5 and Svelte 5, Flotilla-Budabit enables interactive communication through messaging, threads, calendar events, and comprehensive social interaction, leveraging Nostr relays to manage decentralized content and user interactions.

The project has recently expanded to include robust Git integration based on NIP-34, providing seamless collaboration features like issue tracking, repository announcements, patches, and discussions directly through Nostr events.

## Technology Stack

* **Framework:** SvelteKit 2.5, Svelte 5
* **Reactivity:** Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`)
* **Protocol:** Nostr (NIPs: 01, 05, 10, 23, 34, 46, 54, 95)
* **Libraries:** `nostr-tools`, `isomorphic-git`, `@nostr-git`

## Important Patterns

### Finding Code

* Prefer navigating file-by-file using imports.
* Use `ack` for search operations instead of `grep` or `rg`.

### Nostr Event Handling

* Always handle Nostr events using seconds, never milliseconds.
* Utilize `nostr-tools` and a centralized `SimplePool` instance for event subscription and publication.

### Git/Nostr Integration

* Follow the NIP-34 specifications strictly for git-related event handling.
* Git state and issue tracking are maintained through reactive components that subscribe to Nostr event streams.

### Styling Conventions

* Favor `flex` and `gap` CSS classes for layout instead of margin-based or space-y classes.
* Aim for clarity and simplicity in CSS structure.

### Svelte Components

* Use new runes-based syntax: `$state`, `$derived`, `$effect`, `$props`.
* Ensure clear encapsulation and documentation within each component.
* Components should clearly define reactive properties, computed values, and side effects explicitly.

### Room/Space Memberships

Memberships appear as user "bookmarks."

```typescript
import { membershipsByPubkey, getMembershipUrls, getMembershipRooms } from '@app/state';

const spaces = getMembershipUrls($membershipsByPubkey.get(pubkey));
const rooms = getMembershipRooms($membershipsByPubkey.get(pubkey));
```

### Web Worker Usage

* Offload intensive tasks (e.g., git operations using `isomorphic-git`) to WebWorkers to maintain UI responsiveness.
* Clearly serialize messages using structured clone algorithms for worker thread communication.

### Event and Component Patterns

* Prefer callback props (`onclick`) over Svelte's deprecated `createEventDispatcher`.
* Avoid slot usage; migrate to the new snippet (`{@render ...}`) structure.

## Documentation and Code Quality

* Maintain robust, clear inline documentation, especially around complex interactions with Nostr and Git.
* Clearly comment all reactive logic and component lifecycle events to ensure developer maintainability.
