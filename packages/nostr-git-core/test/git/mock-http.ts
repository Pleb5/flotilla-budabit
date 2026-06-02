export interface HttpRequestConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | ArrayBufferView | ArrayBuffer | null;
}

export interface HttpResponse {
  url: string;
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/**
 * Minimal mock HTTP client compatible with isomorphic-git expectations.
 *
 * It explicitly rejects any non-virtual URLs to guarantee that tests never
 * hit the real network. For now we do not implement a full Git smart
 * protocol; test helpers operate directly on LightningFS instead.
 */
export const mockHttp = {
  async request(config: HttpRequestConfig): Promise<HttpResponse> {
    const { url } = config;

    // Guard: never allow real network usage in tests.
    if (!url.startsWith('virtual://')) {
      throw new Error(`Network access is disabled in tests (attempted: ${url})`);
    }

    // At the moment, no tests should rely on HTTP-level Git smart protocol.
    // If this is reached, it indicates a misconfigured test.
    throw new Error(`mockHttp.request was called for ${url}, but virtual Git HTTP protocol is not implemented in this test harness.`);
  },
};
