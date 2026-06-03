import { describe, expect, it, vi } from "vitest";

import { checkTokenCapabilities, getMissingRecommendedTokenCapabilities } from "./tokenCapabilities";

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    ...init,
  });
}

function getCapability(
  result: Awaited<ReturnType<typeof checkTokenCapabilities>>,
  id: string
) {
  return result.capabilities.find((capability) => capability.id === id);
}

describe("token capability checks", () => {
  it("maps GitHub classic scopes to Budabit capabilities", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { login: "alice" },
        { headers: { "x-oauth-scopes": "repo, workflow" } }
      )
    ) as unknown as typeof fetch;

    const result = await checkTokenCapabilities(
      { host: "github.com", token: "ghp_test" },
      { fetchImpl }
    );

    expect(result.valid).toBe(true);
    expect(result.provider).toBe("github");
    expect(result.userLogin).toBe("alice");
    expect(getCapability(result, "repoWrite")?.status).toBe("present");
    expect(getCapability(result, "workflow")?.status).toBe("present");
    expect(getMissingRecommendedTokenCapabilities(result)).toHaveLength(0);
  });

  it("warns when GitHub workflow permission is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ login: "alice" }, { headers: { "x-oauth-scopes": "repo" } })
    ) as unknown as typeof fetch;

    const result = await checkTokenCapabilities(
      { host: "github.com", token: "ghp_test" },
      { fetchImpl }
    );

    expect(result.valid).toBe(true);
    expect(getCapability(result, "workflow")?.status).toBe("missing");
    expect(getMissingRecommendedTokenCapabilities(result).map((capability) => capability.id)).toContain(
      "workflow"
    );
  });

  it("marks rejected provider credentials invalid", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "Bad credentials" }, { status: 401 })) as unknown as typeof fetch;

    const result = await checkTokenCapabilities(
      { host: "github.com", token: "ghp_bad" },
      { fetchImpl }
    );

    expect(result.valid).toBe(false);
    expect(result.capabilities[0]?.status).toBe("missing");
    expect(result.error).toContain("rejected");
  });

  it("maps GitLab token scopes when the self endpoint exposes them", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/personal_access_tokens/self")) {
        return jsonResponse({ scopes: ["api", "read_repository"] });
      }
      return jsonResponse({ username: "alice" });
    }) as unknown as typeof fetch;

    const result = await checkTokenCapabilities(
      { host: "gitlab.com", token: "glpat-test" },
      { fetchImpl }
    );

    expect(result.valid).toBe(true);
    expect(result.provider).toBe("gitlab");
    expect(getCapability(result, "repoCreate")?.status).toBe("present");
    expect(getCapability(result, "issuesPr")?.status).toBe("present");
  });
});
