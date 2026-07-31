/**
 * Host theme support.
 *
 * The Budabit host delivers its UI theme in two places:
 *   - `widget:init`         — `theme` and `themeBackground` fields on the payload
 *   - `widget:themeChanged` — fired whenever the host theme changes
 *
 * These helpers mirror the budabit-sdk theme helpers (kept local until the
 * published SDK ships them — the local SDK source has a `theme.ts` module,
 * but it isn't included in the `budabit-sdk@0.2.0` package published to npm;
 * candidate for `budabit-sdk@0.3.0`): they set `data-theme` on <html> (style
 * with `[data-theme='dark'] { ... }`), sync `color-scheme`, and expose the
 * host's effective background color as the `--host-background` CSS variable.
 */

export type HostTheme = 'light' | 'dark';

type ThemeCapableBridge = {
  onEvent(action: string, handler: (payload: unknown) => void): () => void;
};

const isHostTheme = (value: unknown): value is HostTheme =>
  value === 'light' || value === 'dark';

/** Apply a host theme payload to the document. Safe to call with any payload. */
export function applyHostTheme(payload: unknown): void {
  if (typeof document === 'undefined') return;
  if (!payload || typeof payload !== 'object') return;

  const { theme, themeBackground } = payload as { theme?: unknown; themeBackground?: unknown };
  const root = document.documentElement;

  if (isHostTheme(theme)) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  if (typeof themeBackground === 'string' && themeBackground.length > 0) {
    root.style.setProperty('--host-background', themeBackground);
  }
}

/** Seed a theme from prefers-color-scheme before `widget:init` arrives. */
export function seedHostThemeFallback(): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.theme) return;

  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  applyHostTheme({ theme: prefersDark ? 'dark' : 'light' });
}

/**
 * Seed a fallback theme, then track `widget:init` and `widget:themeChanged`.
 * Returns an unsubscribe function.
 */
export function watchHostTheme(bridge: ThemeCapableBridge): () => void {
  seedHostThemeFallback();

  const offInit = bridge.onEvent('widget:init', applyHostTheme);
  const offChanged = bridge.onEvent('widget:themeChanged', applyHostTheme);

  return () => {
    offInit();
    offChanged();
  };
}
