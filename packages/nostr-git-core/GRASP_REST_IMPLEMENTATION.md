# GRASP REST API Implementation

## Overview

This document describes the implementation of the GRASP REST API vendor support in `nostr-git-core`. This implementation provides an alternative to the event-based GRASP API by using the Smart HTTP Git protocol for querying repository data.

## Implementation Status

### ✅ Completed

1. **Core API Provider** (`src/api/providers/grasp-rest.ts`)
   - Implements `GitServiceApi` interface
   - Uses Smart HTTP Git protocol via `info/refs` endpoint
   - Supports branch and tag listing operations
   - Converts WebSocket URLs (ws://, wss://) to HTTP URLs (http://, https://)

2. **Vendor Type Support** (`src/git/vendor-providers.ts`)
   - Added `"grasp-rest"` to `GitVendor` type union
   - Updated `detectVendorFromUrl()` to default to `grasp-rest` for WebSocket URLs

3. **Provider Factory Integration** (`src/git/provider-factory.ts`)
   - Added `grasp-rest` case to `getGitServiceApi()` factory function
   - Added `grasp-rest` to available providers list
   - Added `grasp-rest` to REST API support check
   - Defaults WebSocket URLs to `grasp-rest` vendor

4. **Vendor Provider Factory** (`src/git/vendor-provider-factory.ts`)
   - Added `grasp-rest` support to `baseUrl()` method
   - Added `grasp-rest` support to `getCloneUrl()` method
   - Added `grasp-rest` support to `getVendorProvider()` function

5. **API Exports** (`src/api/index.ts`)
   - Exported `GraspRestApiProvider` class

6. **Build Verification**
   - Package builds successfully with no errors
   - All TypeScript compilation passes

## API Implementation Details

### Implemented Methods

- `getRepo()` - Fetches repository metadata via `info/refs`
- `listBranches()` - Lists all branches from `refs/heads/*`
- `getBranch()` - Gets specific branch information
- `listTags()` - Lists all tags from `refs/tags/*`
- `getTag()` - Gets specific tag information with archive URLs
- `getCurrentUser()` - Returns user info based on pubkey
- `getUser()` - Resolves npub to user info

### Not Yet Implemented

The following methods throw errors indicating they're not yet implemented:

- `listCommits()` - Requires packfile parsing
- `getCommit()` - Requires packfile parsing
- `getFileContent()` - Requires packfile parsing
- `listDirectory()` - Requires tree object parsing
- Repository mutation operations (create, update, delete, fork)
- Issue operations (delegated to Nostr events)
- Pull request operations (delegated to Nostr pull request events)
- Comment operations (delegated to Nostr events)

## Usage Example

```typescript
import { GraspRestApiProvider } from '@nostr-git/core';

// Create provider with relay URL and pubkey
const provider = new GraspRestApiProvider(
  'wss://relay.example.com',
  'pubkey-hex'
);

// Get repository info
const repo = await provider.getRepo('owner-npub', 'repo-name');

// List branches
const branches = await provider.listBranches('owner-npub', 'repo-name');

// List tags
const tags = await provider.listTags('owner-npub', 'repo-name');
```

## URL Handling

The implementation automatically converts WebSocket relay URLs to HTTP:
- `ws://relay.example.com` → `http://relay.example.com`
- `wss://relay.example.com` → `https://relay.example.com`

Repository URLs follow the pattern:
```
{http-base}/{npub}/{repo-name}.git
```

## Future Work

### High Priority

1. **Packfile Parsing** - Implement full packfile parsing to support:
   - Commit listing and retrieval
   - File content retrieval
   - Directory tree listing

2. **UI Integration** - Update `nostr-git-ui` components:
   - `VendorReadRouter.ts` - Add grasp-rest vendor support
   - Update vendor detection and routing logic
   - Add grasp-rest specific error handling

3. **Flotilla App Integration** - Update main app to use grasp-rest:
   - Update repository selection UI
   - Add grasp-rest relay configuration
   - Update documentation

### Medium Priority

1. **Caching** - Add response caching for frequently accessed data
2. **Error Handling** - Improve error messages and recovery
3. **Testing** - Add comprehensive unit and integration tests
4. **Documentation** - Add API documentation and usage examples

### Low Priority

1. **Performance Optimization** - Optimize packfile parsing
2. **Advanced Features** - Support for shallow clones, partial fetches
3. **Monitoring** - Add metrics and logging

## Reference Implementation

The implementation is based on `@fiatjaf/git-natural-api` which provides:
- Smart HTTP Git protocol support
- Packfile parsing utilities
- Tree and commit parsing
- Reference resolution

Key files from reference:
- `packs.ts` - Packfile fetching and parsing
- `refs.ts` - Reference listing and capabilities
- `commits.ts` - Commit parsing
- `tree.ts` - Tree object parsing

## Architecture Notes

### Design Decisions

1. **Separate Vendor Type** - `grasp-rest` is a distinct vendor from `grasp` to allow:
   - Different implementation strategies
   - Gradual migration path
   - Coexistence of both approaches

2. **Smart HTTP Protocol** - Uses Git's native Smart HTTP protocol:
   - Standard Git wire protocol
   - Compatible with existing Git servers
   - Efficient binary format

3. **Minimal Dependencies** - Implementation uses only:
   - `nostr-tools` for nip19 encoding
   - Native `fetch` API
   - No additional Git libraries

### Trade-offs

**Pros:**
- No need for full Git clone operations
- Lighter weight than `isomorphic-git`
- Direct HTTP access to repository data
- Standard Git protocol compatibility

**Cons:**
- Requires implementing packfile parsing
- More complex than simple REST API
- Binary protocol parsing overhead
- Limited to read operations initially

## Testing

To test the implementation:

```bash
# Build the package
cd packages/nostr-git-core
pnpm build

# Run tests (when implemented)
pnpm test
```

## Migration Path

For existing code using the event-based GRASP API:

1. URLs starting with `ws://` or `wss://` will default to `grasp-rest`
2. To use the old event-based API, explicitly specify `vendor: 'grasp'`
3. Both vendors can coexist during transition period

## Contributing

When contributing to this implementation:

1. Follow existing code style and patterns
2. Add tests for new functionality
3. Update this documentation
4. Ensure TypeScript compilation passes
5. Test with real GRASP relays

## Related Files

- Core implementation: `src/api/providers/grasp-rest.ts`
- Vendor types: `src/git/vendor-providers.ts`
- Factory: `src/git/provider-factory.ts`
- Vendor factory: `src/git/vendor-provider-factory.ts`
- Exports: `src/api/index.ts`
