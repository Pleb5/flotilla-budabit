# Enabled Features Summary

This document tracks all features that have been enabled for development.

## Feature Flags Enabled

All feature flags in `.env` have been enabled:

### `FEATURE_TERMINAL=1`
- **Terminal UI Components**: Enables terminal emulator for Git CLI operations
- **Bundle Impact**: ~150KB
- **Features**: Terminal.svelte component, Git CLI adapters, XTerm.js integration

### `FEATURE_CICD=1` ✨ **NEW**
- **CI/CD Automation**: GitHub Actions integration and automation workflows
- **Bundle Impact**: ~10KB
- **Features**: 
  - Automated workflow triggers
  - Build pipeline integration
  - GitHub Actions event handlers
  - CI/CD tab in repository view

### `FEATURE_NIP34_PR=1` ✨ **NEW**
- **NIP-34 Pull Request Format**: Experimental PR format support
- **Bundle Impact**: ~5KB
- **Features**:
  - Updated PR event structures
  - Enhanced patch metadata
  - PR-specific validation

### `FEATURE_STRICT_NIP29=1` ✨ **NEW**
- **Strict NIP-29 Validation**: Enhanced group/room specification validation
- **Bundle Impact**: ~2KB
- **Features**:
  - Stricter conversation thread validation
  - Enhanced group membership checks
  - Stricter relay requirement enforcement

### `FEATURE_GRASP=1`
- **GRASP Protocol**: Git Repository Announcement State Protocol integration
- **Bundle Impact**: ~50KB
- **Features**: GRASP relay support, repository state synchronization

## Built-in Extensions Auto-Installed

Created `src/app/extensions/builtin.ts` to automatically install and enable built-in extensions on app startup.

### Pipelines Extension (budabit-pipelines)
- **Label**: "Pipelines"
- **Route**: `/cicd` (built-in route)
- **Icon**: Play
- **Features**:
  - View CI/CD pipeline runs
  - Manage workflow executions
  - GitHub Actions integration
  - Workflow file detection and parsing

### Kanban Extension (budabit-kanban)
- **Label**: "Kanban"
- **Route**: `/extensions/budabit-kanban`
- **Icon**: LayoutGrid
- **Entrypoint**: `http://localhost:5178`
- **Features**:
  - NIP-100 Kanban board
  - Repository issue tracking
  - Project management
  - Drag-and-drop interface

## Production Features Integrated

From budabit/dev branch:

### Watch Button
- Repository notification subscriptions
- Watch modal for configuring alerts
- Props: `watchRepo`, `isWatching`

### Notification Badges
- Visual indicators on Issues and Patches tabs
- Shows unread item counts
- Props: `hasIssuesNotification`, `hasPatchesNotification`

### Split-Pane File Viewer
- Files open side-by-side (list on left, viewer on right)
- Uses `displayMode="list"` for browser
- Uses `displayMode="viewer"` for preview panel
- Mobile overlay support

## Development Server

Running at: **http://localhost:1849/**

## Next Steps

1. **Test CI/CD Tab**: Navigate to a repository and verify the "Pipelines" tab appears
2. **Test Kanban Extension**: Start the kanban dev server at port 5178 and test the integration
3. **Verify Feature Flags**: Check that terminal, strict NIP-29, and NIP-34 PR features are active
4. **Extension Development**: Extensions are now auto-enabled, ready for further development

## Files Modified

- `.env` - Enabled all feature flags
- `src/app/extensions/builtin.ts` - Created auto-install mechanism
- `src/routes/+layout.svelte` - Added builtin extension initialization
- `src/routes/spaces/[relay]/git/[id=naddr]/+layout.svelte` - Added watch button and notifications
- `src/routes/spaces/[relay]/git/[id=naddr]/code/+page.svelte` - Added displayMode for split-pane viewer

## Bundle Size Impact

Total additional features enabled: **~217KB**
- TERMINAL: 150KB
- GRASP: 50KB
- CICD: 10KB
- NIP34_PR: 5KB
- STRICT_NIP29: 2KB

This is acceptable for development builds. For production, selectively disable features as needed.
