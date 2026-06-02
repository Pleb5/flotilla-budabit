// Minimal isomorphic-git stub for tests
export async function init(_opts: any): Promise<void> {
  // no-op
}

export async function statusMatrix(_opts: any): Promise<any[]> {
  return [];
}

export async function version(): Promise<string> {
  return 'stub-iso-git-0.0.0';
}
