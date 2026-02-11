# CI/CD Workflow Implementation Plan

## Current State
The CI/CD page in Flotilla-Budabit currently has a "Run workflow" button that only shows a placeholder notification without actually executing any workflows. The workflow data is mocked and the navigation to individual workflow runs is broken due to missing context.

## Implementation Steps

### Phase 1: Fix Immediate Issues
1. **Fix getContext error** in the CI/CD run page
   - Import getContext from Svelte
   - Ensure proper context is set up for repo data

2. **Fix navigation to workflow runs**
   - Ensure proper routing parameters are passed
   - Fix the mock data structure to match the UI expectations

### Phase 2: Implement Basic Workflow Execution
1. **Extend job request system for CI/CD**
   - Modify `publishJobRequest` in commands.ts to handle CI/CD workflow execution
   - Add specific workflow commands and parameters

2. **Implement workflow runner integration**
   - Connect with the Git worker for execution
   - Create workflow execution pipeline

3. **Update UI to show real workflow status**
   - Replace mock data with real workflow execution status
   - Implement polling for workflow run status updates

### Phase 3: Advanced Features
1. **Workflow configuration**
   - Add workflow definition storage (Nostr events)
   - Create UI for editing workflow definitions

2. **Workflow history and logs**
   - Implement proper storage and retrieval of workflow execution history
   - Create detailed log viewing interface

3. **Integration with external CI/CD systems**
   - Add support for GitHub Actions, GitLab CI, etc.
   - Implement authentication and API integration

### Phase 4: Testing and Refinement
1. **Add comprehensive testing**
   - Unit tests for workflow execution
   - Integration tests with external systems

2. **Performance optimization**
   - Optimize polling for workflow status
   - Implement efficient caching strategies

## Technical Details

### Key Files to Modify
- `/src/routes/spaces/[relay]/git/[id=naddr]/cicd/+page.svelte` - Main CI/CD page
- `/src/routes/spaces/[relay]/git/[id=naddr]/cicd/[runId]/+page.svelte` - Workflow run details
- `/src/app/core/commands.ts` - Job request system
- `/src/lib/budabit/state.ts` - CI/CD state management

### Data Structures
- Workflow definitions (Nostr events)
- Workflow runs with status, logs, and results
- Job requests for workflow execution

### API Integration Points
- Git worker for execution
- Nostr relays for data storage
- External CI/CD systems for integration
```

Now let's fix the immediate error with `getContext` in the CI/CD page:</think>
<tool_call>read_file
<arg_key>path</arg_key>
<arg_value>flotilla-budabit/src/routes/spaces/[relay]/git/[id=naddr]/cicd/[runId]/+page.svelte</arg_value>
<arg_key>start_line</arg_key>
<arg_value>1</arg_value>
<arg_key>end_line</arg_key>
<arg_value>40</arg_value>
</tool_call>