# Worker Sync and Commit History - Deployment Checklist

## Pre-Deployment Verification

### ✅ Build Verification
```bash
cd packages/nostr-git/packages/core
pnpm build
```
**Status:** ✅ PASSED - No TypeScript errors

### ✅ Test Verification
```bash
cd packages/nostr-git/packages/core
pnpm test test/workers/sync-and-commits.spec.ts
```
**Status:** ✅ PASSED - 8/8 tests passing

### ✅ Code Changes Summary

**Files Modified:**
1. `packages/core/src/lib/workers/sync.ts` - Enhanced logging and error handling
2. `packages/core/src/lib/workers/git-worker.ts` - Added sync checking and IndexedDB caching
3. `packages/core/src/lib/workers/cache.ts` - Added commit history persistence

**Files Created:**
1. `packages/core/test/workers/sync-and-commits.spec.ts` - Test coverage
2. `WORKER_SYNC_FIXES.md` - Issue documentation
3. `IMPLEMENTATION_SUMMARY.md` - Implementation details
4. `DEPLOYMENT_CHECKLIST.md` - This file

## Deployment Steps

### Step 1: Code Review
- [ ] Review all changes in `sync.ts`
- [ ] Review all changes in `git-worker.ts`
- [ ] Review all changes in `cache.ts`
- [ ] Verify test coverage is adequate

### Step 2: Local Testing
- [ ] Run full test suite: `pnpm test`
- [ ] Build production bundle: `pnpm build`
- [ ] Test in development mode: `pnpm dev`
- [ ] Open browser DevTools and verify logs appear
- [ ] Navigate to a repo page
- [ ] Check console for `[syncWithRemote]` and `[getCommitHistory]` logs
- [ ] Verify IndexedDB contains `commits` object store
- [ ] Refresh page and verify cache hit logs
- [ ] Wait 5+ minutes and verify cache expiry

### Step 3: Staging Deployment
- [ ] Deploy to staging environment
- [ ] Monitor browser console for errors
- [ ] Check IndexedDB structure in Application tab
- [ ] Test with multiple repos
- [ ] Test branch switching
- [ ] Test offline behavior (disconnect network, reload page)
- [ ] Verify commits load from cache when offline
- [ ] Monitor performance (cache hits should be ~50ms)

### Step 4: Production Deployment
- [ ] Deploy to production
- [ ] Monitor error rates in production logs
- [ ] Check user feedback for performance improvements
- [ ] Monitor IndexedDB usage (should stay under 50MB per user)
- [ ] Verify no increase in error rates

### Step 5: Post-Deployment Monitoring
- [ ] Monitor for 24 hours
- [ ] Check for any new error patterns
- [ ] Verify cache hit rates are high (>80%)
- [ ] Check average load times for commit history
- [ ] Gather user feedback

## Rollback Plan

If issues are detected:

### Immediate Rollback
```bash
git revert <commit-hash>
pnpm build
# Deploy previous version
```

### Partial Rollback (Cache Only)
If only caching is problematic, disable cache check in `git-worker.ts`:

```typescript
// Comment out cache check in getCommitHistory
// try {
//   const cachedCommits = await cacheManager.getCommitHistory(key, targetBranch);
//   ...
// } catch (cacheCheckError) {
//   console.warn(`[getCommitHistory] Cache check failed:`, cacheCheckError);
// }
```

### Clear User Caches
If cache corruption is suspected:

```javascript
// Run in browser console
indexedDB.deleteDatabase('nostr-git-cache');
location.reload();
```

## Success Metrics

### Performance
- **Target:** 80%+ cache hit rate
- **Target:** <100ms average load time for cached commits
- **Target:** <2s average load time for fresh commits

### Reliability
- **Target:** <1% error rate for syncWithRemote
- **Target:** <1% error rate for getCommitHistory
- **Target:** Zero unhandled promise rejections

### User Experience
- **Target:** Positive feedback on commit loading speed
- **Target:** No complaints about stale data
- **Target:** Offline access works as expected

## Monitoring Queries

### Browser Console Filters
```
[syncWithRemote]
[getCommitHistory]
```

### IndexedDB Inspection
1. Open DevTools → Application
2. IndexedDB → nostr-git-cache
3. Check `repos` and `commits` stores
4. Verify `lastUpdated` timestamps are recent

### Performance Monitoring
```javascript
// Run in console to check cache stats
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('nostr-git-cache', 1);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const tx = db.transaction(['commits'], 'readonly');
const store = tx.objectStore('commits');
const countRequest = store.count();
countRequest.onsuccess = () => {
  console.log('Cached commit entries:', countRequest.result);
};
```

## Known Issues

### Issue 1: Cache Not Updating
**Symptom:** Commits don't update after remote changes
**Cause:** Cache TTL too long or sync check failing
**Solution:** Clear cache or reduce TTL

### Issue 2: IndexedDB Quota Exceeded
**Symptom:** "QuotaExceededError" in console
**Cause:** Too many commits cached
**Solution:** Reduce cache depth or implement LRU eviction

### Issue 3: Worker Not Loading
**Symptom:** No logs in console, worker errors
**Cause:** Build configuration issue
**Solution:** Verify Vite worker bundling is correct

## Documentation

### For Developers
- See `IMPLEMENTATION_SUMMARY.md` for technical details
- See `WORKER_SYNC_FIXES.md` for issue analysis
- See test file for usage examples

### For Users
- Commits now load much faster (especially on repeat visits)
- Data is cached for offline access
- Automatic sync ensures data stays fresh

## Contact

For issues or questions:
- Check console logs first
- Review `IMPLEMENTATION_SUMMARY.md`
- Check IndexedDB structure
- Review test cases for expected behavior

## Sign-Off

- [ ] Code reviewed by: _______________
- [ ] Tests verified by: _______________
- [ ] Staging tested by: _______________
- [ ] Production deployed by: _______________
- [ ] Post-deployment monitoring by: _______________

## Completion Date

Deployment completed on: _______________

## Notes

Additional notes or observations:

---

**Version:** 1.0
**Last Updated:** 2025-01-22
**Status:** Ready for Deployment
