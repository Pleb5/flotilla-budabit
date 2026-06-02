# GRASP REST API Implementation Roadmap

## Current Status

The GRASP REST API vendor (`grasp-rest`) has been successfully integrated into `nostr-git-core` with basic functionality:

✅ **Completed:**
- Core `GraspRestApiProvider` class
- Repository metadata retrieval via `info/refs`
- Branch and tag listing
- User information lookup
- Vendor type system integration
- Provider factory integration
- Package builds successfully

⚠️ **Partially Implemented:**
- Packfile parsing utilities (structure in place, needs dependencies)
- Commit parsing (helper functions created)
- Tree parsing (helper functions created)

❌ **Not Implemented:**
- Commit listing and retrieval (needs packfile parsing)
- File content retrieval (needs packfile parsing)
- Directory tree listing (needs tree parsing)

## Required Dependencies

To complete the packfile parsing implementation, add these dependencies:

```json
{
  "dependencies": {
    "pako": "^2.1.0",        // zlib compression/decompression
    "js-sha1": "^0.7.0"      // SHA-1 hashing for Git objects
  }
}
```

## Implementation Steps

### Phase 1: Complete Packfile Parsing (High Priority)

1. **Add Dependencies**
   ```bash
   cd packages/nostr-git-core
   pnpm add pako js-sha1
   ```

2. **Complete `grasp-rest-utils.ts`**
   - Replace `inflateZlib()` placeholder with pako implementation
   - Replace `calculateObjectHash()` with js-sha1 implementation
   - Implement `findZlibEnd()` for proper zlib boundary detection
   - Add delta object support (optional, for efficiency)

3. **Implement `fetchPackfile()` in `grasp-rest.ts`**
   ```typescript
   private async fetchPackfile(
     owner: string,
     repo: string,
     wantCommit: string
   ): Promise<PackfileResult> {
     const npub = nip19.npubEncode(owner)
     const url = `${this.baseUrl}/${npub}/${repo}.git/git-upload-pack`
     
     const wantRequest = createWantRequest(wantCommit, [
       'multi_ack_detailed',
       'side-band-64k',
       'agent=git/grasp-rest'
     ])
     
     const response = await fetch(url, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/x-git-upload-pack-request',
         'Accept': 'application/x-git-upload-pack-result',
       },
       body: wantRequest,
     })
     
     if (!response.ok) {
       throw new Error(`Failed to fetch packfile: ${response.statusText}`)
     }
     
     const data = await response.bytes()
     return parsePackfile(data)
   }
   ```

4. **Implement Commit Operations**
   ```typescript
   async listCommits(
     owner: string,
     repo: string,
     options?: ListCommitsOptions
   ): Promise<Commit[]> {
     // Get branch ref
     const branch = options?.sha || await this.getDefaultBranch(owner, repo)
     const refs = await this.getInfoRefs(owner, repo)
     const commitHash = refs.refs[`refs/heads/${branch}`]
     
     if (!commitHash) {
       throw new Error(`Branch not found: ${branch}`)
     }
     
     // Fetch packfile with commits
     const packfile = await this.fetchPackfile(owner, repo, commitHash)
     
     // Parse commits from packfile
     const commits: Commit[] = []
     const perPage = options?.per_page || 30
     
     let currentHash = commitHash
     while (commits.length < perPage && currentHash) {
       const obj = packfile.objects.get(currentHash)
       if (!obj || obj.type !== GitObjectType.Commit) break
       
       const commitData = parseCommit(obj.data, currentHash)
       commits.push(this.convertToCommit(commitData, owner, repo))
       
       // Move to parent
       currentHash = commitData.parents[0] || null
     }
     
     return commits
   }
   ```

5. **Implement File Content Retrieval**
   ```typescript
   async getFileContent(
     owner: string,
     repo: string,
     path: string,
     ref?: string
   ): Promise<{content: string; encoding: string; sha: string}> {
     // Get commit
     const branch = ref || await this.getDefaultBranch(owner, repo)
     const refs = await this.getInfoRefs(owner, repo)
     const commitHash = refs.refs[`refs/heads/${branch}`]
     
     // Fetch packfile
     const packfile = await this.fetchPackfile(owner, repo, commitHash)
     
     // Get commit and tree
     const commitObj = packfile.objects.get(commitHash)
     const commitData = parseCommit(commitObj.data, commitHash)
     
     // Traverse tree to find file
     const fileHash = await this.findFileInTree(
       packfile,
       commitData.tree,
       path
     )
     
     // Get blob content
     const blobObj = packfile.objects.get(fileHash)
     const content = new TextDecoder().decode(blobObj.data)
     
     return {
       content,
       encoding: 'utf-8',
       sha: fileHash
     }
   }
   ```

### Phase 2: UI Integration (Medium Priority)

1. **Update `VendorReadRouter.ts`**
   - Add `grasp-rest` to `SupportedVendor` type
   - Add `grasp-rest` detection in `getSupportedVendor()`
   - Implement `vendorListRefsGraspRest()` method
   - Add grasp-rest cases to all vendor switch statements
   - Handle WebSocket URL conversion

2. **Update Vendor Selection UI**
   - Add grasp-rest option to vendor selection dropdowns
   - Update vendor icons/badges
   - Add grasp-rest specific configuration options

3. **Error Handling**
   - Add grasp-rest specific error messages
   - Handle relay connection failures
   - Add retry logic for transient failures

### Phase 3: Testing (High Priority)

1. **Unit Tests**
   ```typescript
   describe('GraspRestApiProvider', () => {
     it('should parse info/refs response', async () => {
       // Test ref parsing
     })
     
     it('should list branches', async () => {
       // Test branch listing
     })
     
     it('should fetch and parse commits', async () => {
       // Test commit operations
     })
     
     it('should retrieve file content', async () => {
       // Test file retrieval
     })
   })
   ```

2. **Integration Tests**
   - Test against real GRASP relay
   - Test with various repository structures
   - Test error scenarios

3. **Performance Tests**
   - Measure packfile parsing performance
   - Test with large repositories
   - Optimize caching strategy

### Phase 4: Optimization (Low Priority)

1. **Caching**
   - Cache parsed packfiles
   - Cache tree traversals
   - Implement LRU cache for objects

2. **Delta Support**
   - Implement OFS_DELTA parsing
   - Implement REF_DELTA parsing
   - Optimize delta chain resolution

3. **Streaming**
   - Stream large packfiles
   - Progressive commit loading
   - Lazy tree traversal

## Example Usage After Completion

```typescript
import { GraspRestApiProvider } from '@nostr-git/core'

const provider = new GraspRestApiProvider(
  'wss://relay.example.com',
  'user-pubkey-hex'
)

// List commits
const commits = await provider.listCommits('owner-npub', 'repo-name', {
  per_page: 10
})

// Get file content
const file = await provider.getFileContent(
  'owner-npub',
  'repo-name',
  'src/index.ts',
  'main'
)

// Get commit details
const commit = await provider.getCommit(
  'owner-npub',
  'repo-name',
  'commit-sha'
)
```

## Testing Checklist

Before considering the implementation complete:

- [ ] All unit tests pass
- [ ] Integration tests with real GRASP relay pass
- [ ] Can list commits from a repository
- [ ] Can retrieve file content
- [ ] Can list directory contents
- [ ] Error handling works correctly
- [ ] Performance is acceptable (< 2s for typical operations)
- [ ] UI integration works in nostr-git-ui
- [ ] Documentation is complete
- [ ] Examples are provided

## Known Limitations

1. **Delta Objects**: Initial implementation may not support delta compression
2. **Large Repositories**: May have performance issues with very large repos
3. **Shallow Clones**: Not yet supported
4. **Partial Fetches**: Not yet supported
5. **Authentication**: Basic bearer token only

## Resources

- [Git Packfile Format](https://git-scm.com/docs/pack-format)
- [Git Transfer Protocols](https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols)
- [Reference Implementation](https://github.com/fiatjaf/git-natural-api)
- [pako Documentation](https://github.com/nodeca/pako)
- [js-sha1 Documentation](https://github.com/emn178/js-sha1)

## Next Immediate Actions

1. Add `pako` and `js-sha1` dependencies
2. Complete the zlib and SHA-1 implementations in `grasp-rest-utils.ts`
3. Implement `listCommits()` method
4. Test with a real GRASP relay
5. Iterate based on test results
