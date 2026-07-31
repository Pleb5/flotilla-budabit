/**
 * Host theme helpers.
 *
 * The host delivers its UI theme to extensions in two places:
 *   - `widget:init`         — `theme` and `themeBackground` fields on the init payload
 *   - `widget:themeChanged` — fired whenever the host theme or the effective
 *                             background color behind the widget changes
 *
 * `applyHostTheme` translates either payload into DOM state the extension's
 * CSS can key off of:
 *   - `document.documentElement.dataset.theme` is set to `"light"` or `"dark"`
 *     (style with `[data-theme='dark'] { ... }`)
 *   - `color-scheme` is set so native form controls/scrollbars match
 *   - the `--host-background` CSS variable is set to the host's effective
 *     background color, when provided
 */

import type { HostTheme, WidgetThemeChangedPayload } from './types.js';
import type { WidgetBridge } from './bridge.js';

const isHostTheme = (value: unknown): value is HostTheme =>
  value === 'light' || value === 'dark';

/**
 * Apply a host theme payload (`widget:init` or `widget:themeChanged`) to the
 * document. Unknown or missing fields are ignored, so this is safe to call
 * with any host payload.
 */
export function applyHostTheme(payload: unknown): void {
  if (typeof document === 'undefined') return;
  if (!payload || typeof payload !== 'object') return;

  const { theme, themeBackground } = payload as Partial<WidgetThemeChangedPayload>;
  const root = document.documentElement;

  if (isHostTheme(theme)) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  if (typeof themeBackground === 'string' && themeBackground.length > 0) {
    root.style.setProperty('--host-background', themeBackground);
  }
}

/**
 * Seed a theme before the host's `widget:init` arrives, based on the
 * embedder's `prefers-color-scheme`. Prevents a light-mode flash inside a
 * dark host. No-op if a theme has already been applied.
 */
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
 * Wire host theme handling onto a bridge: seeds a fallback theme, then applies
 * the theme from `widget:init` and every `widget:themeChanged` event.
 *
 * Returns an unsubscribe function.
 */
export function watchHostTheme(bridge: WidgetBridge): () => void {
  seedHostThemeFallback();

  const offInit = bridge.onEvent('widget:init', (payload: unknown) => applyHostTheme(payload));
  const offChanged = bridge.onEvent('widget:themeChanged', (payload: unknown) =>
    applyHostTheme(payload),
  );

  return () => {
    offInit();
    offChanged();
  };
}
