# Initial UI Accessibility Snapshot

- **URL:** http://localhost:1847/
- **Captured:** 2026-01-04T16:45:00-08:00 (local dev session)
- **Viewport:** default Playwright Chrome

## Console messages

- `[LOG]` isomorphic git using cors proxy: https://corsproxy.budabit.club @ http://localhost:1847/package...
- `[ERROR]` WebSocket connection to `wss://relay.nostr.band/` failed: Error in connection establishment

## Accessibility tree (interesting nodes)

```yaml
- dialog "" (root container)
  - button "Close dialog"
  - generic "" (landing content wrapper)
    - heading "Welcome to BudaBit!" (level 1)
    - paragraph "The Community for Builders in Freedom-Tech"
    - button "Log in If you've been here before, you know the drill."
      - text "Log in"
      - text "If you've been here before, you know the drill."
    - button "Create an account Just a few questions and you'll be on your way."
      - text "Create an account"
      - text "Just a few questions and you'll be on your way."
    - paragraph "By using BudaBit, you consent to our Terms of Service and Privacy Policy ."
      - link "Terms of Service"
      - link "Privacy Policy"
```

## Key UI anchors for identity bootstrap

- `page.getByRole('heading', { name: 'Welcome to BudaBit!' })` — primary hero identity statement.
- `page.getByRole('button', { name: /Log in/i })` — returning-member authentication entry point.
- `page.getByRole('button', { name: /Create an account/i })` — new-user onboarding call to action.
- `page.getByRole('link', { name: 'Terms of Service' })` and `page.getByRole('link', { name: 'Privacy Policy' })` — policy acknowledgements accompanying identity flow.
