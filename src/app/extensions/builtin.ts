// Built-in extensions are no longer bundled.
// Extensions are installed via Nostr events (kind 30033) or manifest URLs
// in Settings > Extensions.

export const installBuiltinExtensions = () => {
  // no-op — retained for backward compatibility with +layout.svelte call
}
