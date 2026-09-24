import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHostTheme, seedHostThemeFallback, watchHostTheme } from './host-theme.js';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.style.cssText = '';
  vi.unstubAllGlobals();
});
describe('host theme lifecycle', () => {
  it('ignores malformed payloads and applies host theme/background', () => {
    for (const value of [null, false, 'dark', { theme: 'unknown' }]) applyHostTheme(value);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    applyHostTheme({ theme: 'dark', themeBackground: '#123456' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--host-background')).toBe('#123456');
    seedHostThemeFallback();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('seeds a media-query fallback and removes both listeners', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const handlers = new Map<string, (p: unknown) => void>();
    const off = vi.fn();
    const stop = watchHostTheme({
      onEvent: (action, fn) => {
        handlers.set(action, fn);
        return off;
      },
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    handlers.get('widget:themeChanged')?.({ theme: 'light' });
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(off).toHaveBeenCalledTimes(2);
    delete document.documentElement.dataset.theme;
    vi.stubGlobal('matchMedia', undefined);
    seedHostThemeFallback();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
