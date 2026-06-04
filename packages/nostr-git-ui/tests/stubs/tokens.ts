// Minimal tokens store stub for tests
export type Token = { host: string; token: string };

const subs = new Set<(v: Token[]) => void>();

export const tokens = {
  subscribe(fn: (v: Token[]) => void) {
    subs.add(fn);
    // immediate
    fn([]);
    return () => subs.delete(fn);
  },
  async waitForInitialization(): Promise<Token[]> {
    return [];
  },
};
