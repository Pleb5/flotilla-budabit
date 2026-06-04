# GRASP REST UI Integration

## Overview

The `nostr-git-ui` package has been successfully updated to support the `grasp-rest` vendor. This integration allows the UI components to interact with GRASP relays using the REST API approach.

## Changes Made

### 1. VendorReadRouter.ts

**Location:** `src/lib/components/git/VendorReadRouter.ts`

#### Type Updates

- Added `"grasp-rest"` to `SupportedVendor` type union (line 83)

```typescript
type SupportedVendor = "github" | "gitlab" | "gitea" | "bitbucket" | "grasp-rest";
```

#### Vendor Detection

- Updated `getSupportedVendor()` to recognize `grasp-rest` vendor (lines 486-498)

```typescript
private getSupportedVendor(remoteUrl: string): SupportedVendor | null {
  try {
    const v = detectVendorFromUrl(remoteUrl) as any;
    if (v === "github") return "github";
    if (v === "gitlab") return "gitlab";
    if (v === "gitea") return "gitea";
    if (v === "bitbucket") return "bitbucket";
    if (v === "grasp-rest") return "grasp-rest";
    return null;
  } catch {
    return null;
  }
}
```

#### API Base URL Conversion

- Updated `getApiBase()` to handle WebSocket to HTTP conversion (lines 1569-1593)

```typescript
private getApiBase(vendor: SupportedVendor, host: string): string {
  const h = host.trim();
  // ... other vendors ...
  else if (vendor === "grasp-rest") {
    // For grasp-rest, convert ws(s):// to http(s)://
    if (h.startsWith("ws://")) {
      return h.replace("ws://", "http://");
    } else if (h.startsWith("wss://")) {
      return h.replace("wss://", "https://");
    }
    return `https://${h}`;
  }
  return `https://${h}`;
}
```

#### Authentication Headers

- Updated `vendorHeaders()` to support grasp-rest authentication (lines 1695-1713)

```typescript
private vendorHeaders(vendor: SupportedVendor, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (!token) return headers;

  // ... other vendors ...
  else if (vendor === "grasp-rest") {
    // grasp-rest uses bearer token for authentication
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
```

#### Switch Statement Updates

All vendor routing methods now include `grasp-rest` cases with proper default error handling:

1. **`vendorListRefs()`** (lines 616-628)
   - Routes to `vendorListRefsGraspRest()`

2. **`vendorListDirectory()`** (lines 572-592)
   - Routes to `vendorListDirectoryGraspRest()`

3. **`vendorGetFileContent()`** (lines 594-614)
   - Routes to `vendorGetFileContentGraspRest()`

4. **`vendorListCommits()`** (lines 631-652)
   - Routes to `vendorListCommitsGraspRest()`

#### Grasp-Rest Vendor Methods

**New methods implemented:**

1. **`vendorListRefsGraspRest()`** (lines 1208-1244)
   - Fetches branches and tags from GRASP relay
   - Uses `/repos/{owner}/{repo}/branches` and `/repos/{owner}/{repo}/tags` endpoints
   - Returns unified `VendorRef[]` array

```typescript
private async vendorListRefsGraspRest(remoteUrl: string): Promise<VendorRef[]> {
  const { host, owner, repo } = this.parseOwnerRepoFromCloneUrl(remoteUrl);
  const apiBase = this.getApiBase("grasp-rest", host);

  const branchesUrl = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`;
  const tagsUrl = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags`;

  const [branchesJson, tagsJson] = await Promise.all([
    this.fetchJsonWithOptionalTokenRetry({ host, url: branchesUrl, vendor: "grasp-rest", ctx }),
    this.fetchJsonWithOptionalTokenRetry({ host, url: tagsUrl, vendor: "grasp-rest", ctx }),
  ]);

  // Parse and return refs
}
```

2. **`vendorListDirectoryGraspRest()`** (lines 1123-1168)
   - Lists directory contents at a specific path
   - Uses `/repos/{owner}/{repo}/tree/{branch}/{path}` endpoint
   - Returns `VendorDirectoryResult` with file/directory info

3. **`vendorGetFileContentGraspRest()`** (lines 1170-1206)
   - Retrieves file content at a specific path
   - Uses `/repos/{owner}/{repo}/blob/{branch}/{path}` endpoint
   - Returns `VendorFileContentResult` with content and metadata

4. **`vendorListCommitsGraspRest()`** (lines 1246-1301)
   - Lists commits for a branch with pagination
   - Uses `/repos/{owner}/{repo}/commits?sha={branch}&page={page}&per_page={perPage}` endpoint
   - Returns `VendorCommitResult` with commit history

## API Endpoints Used

The grasp-rest vendor implementation expects the following REST API endpoints:

| Endpoint                                     | Method | Purpose                 |
| -------------------------------------------- | ------ | ----------------------- |
| `/repos/{owner}/{repo}/branches`             | GET    | List all branches       |
| `/repos/{owner}/{repo}/tags`                 | GET    | List all tags           |
| `/repos/{owner}/{repo}/tree/{branch}/{path}` | GET    | List directory contents |
| `/repos/{owner}/{repo}/blob/{branch}/{path}` | GET    | Get file content        |
| `/repos/{owner}/{repo}/commits?sha={branch}` | GET    | List commits            |

## URL Format

GRASP REST URLs follow this pattern:

```
wss://relay.example.com  →  https://relay.example.com
ws://relay.example.com   →  http://relay.example.com
```

Repository paths:

```
{http-base}/repos/{npub}/{repo-name}
```

## Authentication

The implementation uses Bearer token authentication:

```
Authorization: Bearer {token}
```

The token is typically the user's Nostr private key or a derived authentication token.

## Error Handling

All vendor methods include:

- Context strings for debugging
- Optional token retry logic
- Proper error propagation
- Default cases in switch statements to catch unsupported vendors

## Build Status

✅ **Package builds successfully with no errors**

```bash
cd packages/nostr-git-ui
pnpm build
# Exit code: 0
```

## Testing Recommendations

To test the grasp-rest integration:

1. **Unit Tests**
   - Test vendor detection for WebSocket URLs
   - Test URL conversion (ws:// → http://)
   - Test API endpoint construction
   - Mock fetch responses for each vendor method

2. **Integration Tests**
   - Test with a real GRASP relay
   - Verify branch/tag listing
   - Verify file content retrieval
   - Verify commit history
   - Test error scenarios (404, auth failures)

3. **UI Tests**
   - Test repository selection with grasp-rest URLs
   - Test file browser with grasp-rest repos
   - Test commit history view
   - Test error message display

## Usage Example

```typescript
import { VendorReadRouter } from "@nostr-git/ui";

const router = new VendorReadRouter({
  getTokens: async () => [{ host: "relay.example.com", token: "user-token" }],
  preferVendorReads: true,
});

// List refs from a GRASP relay
const refs = await router.listRefs(["https://relay.example.com/npub.../repo.git"]);

// Get file content
const content = await router.getFileContent(
  ["https://relay.example.com/npub.../repo.git"],
  "main",
  "src/index.ts"
);

// List commits
const commits = await router.listCommits(["https://relay.example.com/npub.../repo.git"], "main", {
  page: 1,
  perPage: 30,
});
```

## Next Steps

1. **Update Flotilla App** - Integrate grasp-rest support into the main Flotilla application
2. **Add UI Components** - Create vendor selection UI for grasp-rest
3. **Add Configuration** - Allow users to configure GRASP relay URLs
4. **Add Documentation** - User-facing documentation for GRASP relay usage
5. **Add Tests** - Comprehensive test suite for grasp-rest vendor

## Known Limitations

1. **API Compatibility** - The implementation assumes GitHub-like REST API endpoints. Actual GRASP relay APIs may differ.
2. **Authentication** - Currently uses simple Bearer token auth. May need to support Nostr-specific auth schemes.
3. **Error Messages** - Generic error messages may need to be more GRASP-specific.
4. **Caching** - No caching implemented yet for vendor API responses.

## Related Files

- Core implementation: `packages/nostr-git-core/src/api/providers/grasp-rest.ts`
- UI integration: `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- Documentation: `packages/nostr-git-core/GRASP_REST_IMPLEMENTATION.md`
- Roadmap: `packages/nostr-git-core/GRASP_REST_ROADMAP.md`
