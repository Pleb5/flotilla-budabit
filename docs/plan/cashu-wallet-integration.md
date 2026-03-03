# Cashu Wallet Integration Plan

## Overview

Integrate `coco-cashu-core@1.1.2-rc.47` (with `coco-cashu-indexeddb`) into flotilla-budabit as a **site-wide, multi-mint Cashu wallet** that:

- Lives in the same settings page as the existing Lightning wallet (`/settings/wallet`)
- Is accessible globally via a floating balance indicator / modal
- Exposes wallet operations to iframes via the postMessage bridge
- Requires seed phrase backup confirmation before first use
- Tracks sent token history so users can re-copy lost tokens

---

## Reference Architecture

The [`reference/nostr-workflow/hive-ci-site`](../reference/nostr-workflow/hive-ci-site) project uses `coco-cashu-core` + `coco-cashu-indexeddb` in a Vue 3 app. The key patterns we adapt to Svelte 5 / SvelteKit:

| hive-ci-site pattern | budabit equivalent |
|---|---|
| `CashuWallet` singleton service class | `src/app/core/cashu.ts` singleton store module |
| `useCashu()` Vue composable | Svelte 5 `$state`/`$derived` reactive stores |
| `WalletDropdown.vue` shared component | `CashuWalletModal.svelte` global modal |
| Pinia `wallet` store | `writable` / `derived` Svelte stores |
| `localStorage` mnemonic storage | `localStorage` + **backup confirmation gate** |

---

## Goals & Guardrails

### Goals
1. Multi-mint Cashu wallet backed by `coco-cashu-core` + IndexedDB
2. Seed phrase generated on first use; user must confirm backup before wallet is active
3. Site-wide floating balance widget (visible when logged in) that opens a full wallet modal
4. Modal supports: balance per mint, receive token (paste cashuA…), send/create token, token history, Lightning top-up
5. Sent tokens are stored in history so the user can re-copy them if lost
6. Wallet operations exposed to iframes via new `cashu:*` bridge actions
7. Settings page section (same page as Lightning) for mint management and seed phrase backup

### Guardrails
- **No auto-spend**: wallet never spends without explicit user action (or pre-approved extension)
- **No key exposure**: mnemonic never leaves the browser; never sent over network
- **Iframe permission model**: iframes must declare `cashu:pay` permission; balance queries are read-only and always allowed
- **Backup gate**: wallet is locked (read-only) until user has confirmed seed phrase backup
- **Token history is local-only**: stored in `localStorage`, never published to Nostr

---

## Decisions (Confirmed)

| # | Question | Decision |
|---|---|---|
| 1 | Default mints | Display Minibits (`https://mint.minibits.cash/Bitcoin`) as a suggested mint; mints are added by the user when they first deposit (not auto-added) |
| 2 | Iframe payment flow | Show confirmation modal per payment; include **"Always allow [extension name]"** checkbox to whitelist an extension for future auto-payments |
| 3 | Token history | Cap at **100 entries** (FIFO); show last 3 add/deduct entries inline, rest behind "Show more" |
| 4 | Mnemonic storage | Plaintext `localStorage` for now |
| 5 | Multi-account | **Single wallet per browser** — not tied to Nostr pubkey; one mnemonic for all accounts on the device |
| 6 | Lightning top-up | **Required** — include mint quote → Lightning invoice → receive proofs flow in the modal |
| 7 | Capacitor storage | Use `@capacitor/preferences` on native (iOS/Android) with `localStorage` fallback on web — see rationale below |

### Decision 7 Rationale: Capacitor Storage

`localStorage` is wiped by iOS when the app is backgrounded for too long or when the OS clears WebView storage under memory pressure. `@capacitor/preferences` persists to native `UserDefaults` (iOS) / `SharedPreferences` (Android), which survives app restarts and OS storage pressure. Since the mnemonic is the only way to recover funds, losing it silently would be catastrophic. The project already has `@capacitor/preferences` in its dependencies, so this adds no new package.

Implementation: a thin `storage.ts` adapter that calls `Preferences.set/get` on native and `localStorage` on web (using `Capacitor.isNativePlatform()`).

---

## Architecture

### New Files

```
flotilla-budabit/src/
├── app/
│   ├── core/
│   │   └── cashu.ts                    # Wallet service singleton + Svelte stores
│   └── components/
│       ├── CashuWalletModal.svelte     # Full wallet modal (balance, receive, send, history)
│       ├── CashuWalletWidget.svelte    # Floating balance chip (opens modal)
│       ├── CashuSeedBackup.svelte      # Seed phrase display + confirmation step
│       ├── CashuReceive.svelte         # Paste & redeem cashuA token
│       ├── CashuSend.svelte            # Create outgoing token
│       └── CashuMintManager.svelte     # Add/remove mints (used in settings)
```

### Modified Files

```
flotilla-budabit/src/
├── routes/
│   ├── +layout.svelte                  # Mount CashuWalletWidget globally
│   └── settings/
│       └── wallet/
│           └── +page.svelte            # Add Cashu section below Lightning section
├── app/
│   ├── extensions/
│   │   └── bridge.ts                   # Register cashu:* bridge handlers
│   └── extensions/
│       └── types.ts                    # Add cashu:* to permission types
```

---

## Core Service: `src/app/core/cashu.ts`

Adapted from [`reference/nostr-workflow/hive-ci-site/src/services/cashu/wallet.ts`](../reference/nostr-workflow/hive-ci-site/src/services/cashu/wallet.ts).

### Key differences from reference

- Uses Svelte `writable` stores instead of Vue refs for reactivity
- Mnemonic is stored under a **single global key** (`budabit_cashu_mnemonic`) — one wallet per browser, not per Nostr account
- A `backupConfirmed` flag (`budabit_cashu_backup_confirmed`) gates write operations
- Token history is stored in `localStorage` as a JSON array under `budabit_cashu_history` (capped at 100 entries)
- On Capacitor (native), mnemonic and backup flag use `@capacitor/preferences` instead of `localStorage`
- Extension auto-pay whitelist stored under `budabit_cashu_autopay_whitelist` as a JSON array of extension IDs

### Exported stores & API

```typescript
// Reactive stores
export const cashuInitialized: Writable<boolean>
export const cashuBackupConfirmed: Writable<boolean>
export const cashuTotalBalance: Writable<number>
export const cashuBalancesByMint: Writable<Map<string, number>>
export const cashuMints: Writable<string[]>
export const cashuTokenHistory: Writable<TokenHistoryEntry[]>
export const cashuAutoPayWhitelist: Writable<string[]>   // extension IDs allowed to auto-pay

// Service functions
export const initializeCashuWallet: () => Promise<void>
export const getCashuMnemonic: () => string              // for backup display
export const confirmCashuBackup: () => void
export const addCashuMint: (url: string) => Promise<void>
export const removeCashuMint: (url: string) => Promise<void>
export const receiveCashuToken: (token: string) => Promise<number>
export const createCashuToken: (amount: number, mintUrl: string) => Promise<string>
export const refreshCashuBalances: () => Promise<void>
export const addAutoPayWhitelist: (extensionId: string) => void
export const removeAutoPayWhitelist: (extensionId: string) => void

// Lightning top-up (mint quote flow)
export const requestMintQuote: (mintUrl: string, amount: number) => Promise<{ quote: string; request: string }>
export const checkMintQuote: (mintUrl: string, quote: string) => Promise<'paid' | 'unpaid' | 'expired'>
export const mintTokensFromQuote: (mintUrl: string, quote: string, amount: number) => Promise<void>

// Token history entry
export interface TokenHistoryEntry {
  id: string           // random uuid
  direction: 'sent' | 'received' | 'minted'
  amount: number
  mintUrl: string
  token?: string       // full cashuA token string (for re-copy; only for 'sent')
  createdAt: number    // unix timestamp
  label?: string       // optional user label (e.g. extension name for auto-pay)
}
```

### Initialization flow

```
app startup (layout.svelte)
  └─ initializeCashuWallet()
       ├─ load or generate mnemonic (Capacitor.Preferences on native, localStorage on web)
       ├─ check backupConfirmed flag
       ├─ init IndexedDbRepositories({ name: 'budabit-coco-wallet' })
       ├─ initializeCoco({ repo, seedGetter, ... })
       ├─ load saved mints from localStorage
       ├─ add each mint via manager.mint.addMint()
       └─ refresh balances → update stores
```

---

## Seed Phrase Backup Gate

On first wallet creation (no mnemonic in storage), the wallet is initialized but `cashuBackupConfirmed` is `false`. Any attempt to **send** tokens, **create payment tokens**, or **mint via Lightning** will:

1. Open `CashuSeedBackup.svelte` modal
2. Display the 12-word mnemonic with a "Copy all words" button
3. Require the user to re-enter 3 randomly selected words to confirm they wrote it down
4. On success: set `backupConfirmed = true` in storage and proceed

Receiving tokens (redeeming a cashuA token someone sent you) is allowed without backup confirmation (no funds at risk).

---

## Global Wallet Widget

`CashuWalletWidget.svelte` is mounted in [`src/routes/+layout.svelte`](../flotilla-budabit/src/routes/+layout.svelte) inside the authenticated section (alongside `AppContainer`). It renders as a small pill/chip in the top-right corner showing total balance in sats. Clicking it opens `CashuWalletModal.svelte` via `pushModal`.

```
┌─────────────────────────────────────────────────────────┐
│  [⚡ Lightning]  [₿ 1,250 sats ▼]  [Profile]  [...]    │  ← PrimaryNav
└─────────────────────────────────────────────────────────┘
```

The widget is always visible when the user is logged in (even at 0 balance) to encourage wallet setup. When balance is 0 and wallet is not yet set up, it shows "Set up Cashu" instead of a balance.

---

## Wallet Modal: `CashuWalletModal.svelte`

Tabs:
1. **Balance** — per-mint balance breakdown, total; last 3 history entries inline with "Show all" link
2. **Receive** — paste cashuA token → redeem → show received amount; OR Lightning top-up (mint quote → QR code invoice → poll for payment)
3. **Send** — select mint, enter amount, optional label → create token → copy to clipboard → auto-saved to history
4. **History** — list of last 100 sent/received/minted entries; last 3 visible by default, rest behind "Show more"; re-copy button for sent tokens
5. **Mints** — add/remove mints with balance display; Minibits shown as suggested default

### Lightning Top-up Flow (in Receive tab)

```
User clicks "Top up via Lightning"
  └─ select mint + enter amount
       └─ requestMintQuote(mintUrl, amount)
            ├─ display Lightning invoice as QR code + copyable string
            ├─ poll checkMintQuote() every 3s (up to 10 min)
            │    ├─ 'paid' → mintTokensFromQuote() → refresh balances → show success
            │    ├─ 'unpaid' → keep polling
            │    └─ 'expired' → show error, offer retry
            └─ user can cancel at any time
```

---

## Settings Page Integration

[`src/routes/settings/wallet/+page.svelte`](../flotilla-budabit/src/routes/settings/wallet/+page.svelte) currently shows only the Lightning wallet. A new **Cashu Wallet** section is added below it:

```
┌─────────────────────────────────────────────────────────┐
│  ⚡ Lightning Wallet                    [Connected ✓]   │
│  ...existing content...                                  │
├─────────────────────────────────────────────────────────┤
│  ₿ Cashu Wallet                        [1,250 sats]     │
│                                                          │
│  Mints:                                                  │
│  • https://mint.minibits.cash/Bitcoin   850 sats  [✕]   │
│  • https://testnut.cashu.space          400 sats  [✕]   │
│  [+ Add Mint]  (Minibits suggested if no mints yet)      │
│                                                          │
│  Seed Phrase:  [Backed up ✓]  or  [⚠ Backup Now]       │
│                                                          │
│  Auto-pay whitelist:                                     │
│  • CI/CD Pipeline Runner  [Revoke]                       │
│                                                          │
│  [Open Wallet]                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Bridge Integration (iframes)

New bridge actions registered in [`src/app/extensions/bridge.ts`](../flotilla-budabit/src/app/extensions/bridge.ts):

| Action | Permission required | Description |
|---|---|---|
| `cashu:getBalance` | none (read-only) | Returns `{ total: number, byMint: Record<string, number> }` — all mint balances in one call |
| `cashu:getMints` | none (read-only) | Returns `string[]` of configured mint URLs (no balances; use `cashu:getBalance` for balances) |
| `cashu:createToken` | `cashu:pay` | Creates a payment token; shows confirmation modal (unless whitelisted) |
| `cashu:receiveToken` | `cashu:receive` | Redeems a token into the wallet |

> **Note for widget authors**: Use `cashu:getBalance` (not `cashu:getMints`) to get all mint balances at once. The `byMint` field is a plain object mapping mint URL → balance in sats. Widgets should use this to decide which mint to request payment from (e.g. pick the mint with sufficient balance for the operation).

**Example response from `cashu:getBalance`:**
```json
{
  "total": 1250,
  "byMint": {
    "https://mint.minibits.cash/Bitcoin": 850,
    "https://testnut.cashu.space": 400
  }
}
```

### `cashu:createToken` flow (with user confirmation + whitelist)

```
iframe → bridge.request('cashu:createToken', { amount, mintUrl, label })
  └─ bridge handler
       ├─ check permission 'cashu:pay'
       ├─ check cashuAutoPayWhitelist.includes(extensionId)
       │    ├─ YES → createCashuToken() directly → return { token }
       │    └─ NO  → pushModal(CashuPayConfirm, { amount, mintUrl, label, extensionId })
       │                 ├─ user sees: "CI/CD Pipeline wants to spend X sats from [mint]"
       │                 ├─ checkbox: "Always allow CI/CD Pipeline to deduct"
       │                 └─ Approve / Reject buttons
       ├─ on Approve (with "always allow"): addAutoPayWhitelist(extensionId) + createCashuToken()
       ├─ on Approve (one-time): createCashuToken()
       │    ├─ save to token history with label = extensionId
       │    └─ return { token }
       └─ on Reject: return { error: 'user_rejected' }
```

### Iframes that need wallet access

| Extension / iframe | Required actions | Notes |
|---|---|---|
| **CI/CD pipeline runner** (`cicd/+page.svelte`) | `cashu:createToken`, `cashu:getBalance` | Currently hardcodes `cashuToken = "cashuTEST"` (line 55) — primary use case |
| **Kanban board** | none currently | May need `cashu:getBalance` for bounty display in future |
| **Smart Widgets (kind 30033)** | declared via `permission` tags | Any widget can request `cashu:pay` / `cashu:receive` permissions |
| **Huddle audio** | none | No payment use case |

The CI/CD page at [`src/routes/spaces/[relay]/git/[id=naddr]/cicd/+page.svelte`](../flotilla-budabit/src/routes/spaces/[relay]/git/[id=naddr]/cicd/+page.svelte) currently has `let cashuToken = $state("cashuTEST")` (line 55). This will be replaced with a call to `createCashuToken()` from the wallet service (since the CI/CD page is a **built-in route**, not an iframe, it can call the service directly without going through the bridge). The confirmation modal will still be shown (unless the user has whitelisted the pipeline runner).

---

## Package Dependencies

Add to `flotilla-budabit/package.json`:

```json
"coco-cashu-core": "1.1.2-rc.47",
"coco-cashu-indexeddb": "rc",
"@scure/bip39": "^1.2.1"
```

Notes:
- `@scure/bip39` is needed for mnemonic generation and seed derivation (same as reference)
- `@capacitor/preferences` is already in the project dependencies — no new package needed for native storage
- `qrcode` is already in the project dependencies — can be reused for Lightning invoice QR display

---

## Implementation Phases

### Phase 1: Core wallet service
- [ ] Add npm dependencies (`coco-cashu-core@1.1.2-rc.47`, `coco-cashu-indexeddb@rc`, `@scure/bip39`)
- [ ] Create `src/app/util/cashu-storage.ts` — thin adapter: `Preferences` on native, `localStorage` on web
- [ ] Create `src/app/core/cashu.ts` with `initializeCoco`, stores, service functions, and Lightning top-up API
- [ ] Wire `initializeCashuWallet()` into `+layout.svelte` (inside the `{:then}` block, after app init)

### Phase 2: Seed backup gate
- [ ] Create `CashuSeedBackup.svelte` — display mnemonic + "Copy all" + 3-word confirmation quiz
- [ ] Gate `createCashuToken` and `mintTokensFromQuote` behind `cashuBackupConfirmed` check

### Phase 3: Settings page section
- [ ] Create `CashuMintManager.svelte` — add/remove mints with balance display; Minibits as suggested default
- [ ] Update `settings/wallet/+page.svelte` — add Cashu section below Lightning (with auto-pay whitelist management)

### Phase 4: Global wallet modal
- [ ] Create `CashuReceive.svelte` — paste & redeem token
- [ ] Create `CashuTopUp.svelte` — Lightning top-up (mint quote → QR invoice → poll → success)
- [ ] Create `CashuSend.svelte` — create outgoing token + copy + save history
- [ ] Create `CashuHistory.svelte` — last 100 entries, 3 visible by default, re-copy for sent tokens
- [ ] Create `CashuWalletModal.svelte` — tabbed modal combining all sub-components
- [ ] Create `CashuWalletWidget.svelte` — balance chip (always visible when logged in)
- [ ] Mount widget in `+layout.svelte` inside the authenticated `{#if $pubkey}` block

### Phase 5: Bridge integration
- [ ] Add `cashu:pay` and `cashu:receive` to permission types in `src/app/extensions/types.ts`
- [ ] Register `cashu:getBalance`, `cashu:getMints`, `cashu:createToken`, `cashu:receiveToken` handlers in `bridge.ts`
- [ ] Create `CashuPayConfirm.svelte` — user approval modal with "Always allow [name]" checkbox

### Phase 6: CI/CD integration
- [ ] Replace `cashuToken = $state("cashuTEST")` in `cicd/+page.svelte` with real wallet call
- [ ] Add "Insufficient balance" error handling in the run workflow modal
- [ ] Show wallet balance in the "Run workflow" modal so user knows if they have enough funds

---

## Security Considerations

1. **Mnemonic storage**: Stored in `localStorage` (web) / `@capacitor/preferences` (native) in plaintext. NIP-44 encryption is a future consideration.
2. **Iframe isolation**: `cashu:createToken` requires user confirmation unless the extension is whitelisted. Whitelist is user-managed and revocable.
3. **Token history**: Stored locally only, never published to Nostr relays. Capped at 100 entries.
4. **Backup gate**: Prevents accidental loss of funds before user has secured their seed phrase.
5. **Mint trust**: Users explicitly add mints; Minibits is only suggested, never auto-added.
6. **Amount limits**: Per-extension spending limits are a future consideration.
7. **Auto-pay whitelist**: Stored in `localStorage`; revocable from settings page.

---

## Implementation Notes

1. `initializeCashuWallet()` should be called **eagerly** on app load (inside `+layout.svelte`'s `{:then}` block) so balance is available immediately when the user opens the wallet widget.
2. The `coco-cashu-core` `initializeCoco` call should **disable** `mintQuoteWatcher` and `proofStateWatcher` (as in the reference) and instead use manual polling in `CashuTopUp.svelte` for the Lightning top-up flow. This avoids background processes that could interfere with the app.
3. The wallet widget should be mounted **inside `PrimaryNav`** (or as a sibling to it in `AppContainer`) rather than as a fixed-position overlay, to integrate naturally with the existing nav layout.
4. The CI/CD page calls the wallet service directly (not via bridge) since it is a built-in route with full access to the app's module graph.
5. The `qrcode` package already in the project can be reused for Lightning invoice QR display in `CashuTopUp.svelte`.