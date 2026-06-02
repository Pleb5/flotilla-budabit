/**
 * Environment + global flag helpers for tests.
 *
 * - withEnv: temporarily patches process.env keys and restores prior values.
 * - withGlobalFlag: temporarily sets globalThis[key] and restores prior descriptor/value.
 */

export async function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const env: Record<string, string | undefined> = (process as any).env || {};
  const prev: Record<string, string | undefined> = {};

  for (const [k, v] of Object.entries(patch)) {
    prev[k] = env[k];
    if (typeof v === 'undefined') {
      delete env[k];
    } else {
      env[k] = v;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (typeof v === 'undefined') {
        delete env[k];
      } else {
        env[k] = v;
      }
    }
  }
}

export function withGlobalFlag<T>(key: string, value: any, fn: () => T): T {
  const g: any = globalThis as any;
  const had = Object.prototype.hasOwnProperty.call(g, key);
  const prevDesc = Object.getOwnPropertyDescriptor(g, key);

  try {
    Object.defineProperty(g, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true
    });
    return fn();
  } finally {
    try {
      if (!had) {
        // restore to "not present"
        delete g[key];
      } else if (prevDesc) {
        Object.defineProperty(g, key, prevDesc);
      } else {
        g[key] = g[key];
      }
    } catch {
      // Best-effort restore only; ignore restore errors to avoid masking test failures.
    }
  }
}