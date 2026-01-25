# Kanban Boards Feature Plan

**Issue**: `flotilla-kjuvink3`
**Status**: Planning
**Priority**: P0

## Overview

Implement Kanban boards for repository issue tracking and project management, following the NIP-100 (kanbanstr) specification. This feature will provide a visual, column-based view for managing issues, patches, and custom work items within a repository.

---

## Architecture

### Extension-Based Approach

The Kanban feature is designed as a **repo-tab extension** that integrates with Flotilla's existing extension system:

```
+----------------------------------+
|        Flotilla Host App         |
|  +----------------------------+  |
|  |   Extension Registry       |  |
|  |   - loadIframeExtension()  |  |
|  |   - RepoContext injection  |  |
|  +----------------------------+  |
|              |                   |
|  +----------------------------+  |
|  |   Kanban Extension (iframe)|  |
|  |   - Receives repo context  |  |
|  |   - Uses bridge API        |  |
|  +----------------------------+  |
+----------------------------------+
```

### Manifest Configuration (existing)

Located at `static/extensions/kanban.json`:
```json
{
  "id": "budabit-kanban",
  "kind": 31990,
  "name": "Repo Kanban",
  "description": "NIP-100 Kanban board for repository issue tracking.",
  "entrypoint": "http://localhost:5178",
  "permissions": ["nostr:publish", "nostr:query", "ui:toast"],
  "slot": {
    "type": "repo-tab",
    "label": "Kanban",
    "path": "kanban"
  }
}
```

---

## Data Model (NIP-100 Kanbanstr)

### Event Kinds

| Kind | Purpose | Description |
|------|---------|-------------|
| **30301** | Board Definition | Defines a Kanban board with columns |
| **30302** | Card | Individual card on a board |
| **30303** | Card Move | Card position/column change event (optional) |

### Board Event (Kind 30301)

```json
{
  "kind": 30301,
  "content": "<optional description>",
  "tags": [
    ["d", "<board-identifier>"],
    ["name", "Sprint Board"],
    ["a", "30617:<pubkey>:<repo-name>"],
    ["column", "backlog", "Backlog"],
    ["column", "todo", "To Do"],
    ["column", "in-progress", "In Progress"],
    ["column", "review", "Review"],
    ["column", "done", "Done"]
  ]
}
```

### Card Event (Kind 30302)

```json
{
  "kind": 30302,
  "content": "<card description>",
  "tags": [
    ["d", "<card-identifier>"],
    ["title", "Implement auth flow"],
    ["a", "30301:<pubkey>:<board-d-tag>"],
    ["column", "in-progress"],
    ["e", "<linked-issue-id>", "", "issue"],
    ["e", "<linked-patch-id>", "", "patch"],
    ["p", "<assignee-pubkey>"],
    ["priority", "high"],
    ["due", "<unix-timestamp>"]
  ]
}
```

### State Derivation

Cards can be:
1. **Standalone**: Created directly on the board
2. **Linked to Issues**: Reference existing NIP-34 issues via `#e` tag
3. **Linked to Patches**: Reference existing NIP-34 patches via `#e` tag

When linked, the card inherits:
- Title from issue/patch subject
- Status from issue/patch status events (1630-1633)
- Labels from NIP-32 label events

---

## Components Needed

### Extension Components (New Package)

```
packages/flotilla-kanban/
  src/
    components/
      Board.svelte           # Main board container
      Column.svelte          # Individual column
      Card.svelte            # Draggable card
      CardEditor.svelte      # Create/edit card modal
      BoardSettings.svelte   # Column configuration
      ColumnHeader.svelte    # Column title + actions
    lib/
      bridge.ts              # Host communication
      store.ts               # Kanban state management
      nip100.ts              # NIP-100 event builders
    App.svelte
    main.ts
```

### Host Integration Points

| File | Changes |
|------|---------|
| `src/app/extensions/bridge.ts` | Add `nostr:query` support for kinds 30301, 30302 |
| `src/app/extensions/types.ts` | Already supports `repo-tab` slot type |
| `src/routes/spaces/[relay]/git/[id=naddr]/extensions/[extId]/+page.svelte` | Existing extension rendering |

---

## Implementation Phases

### Phase 1: Core Board Infrastructure (Week 1-2)

- [ ] Create `packages/flotilla-kanban` using extension template
- [ ] Implement Board.svelte with drag-and-drop columns
- [ ] Implement Column.svelte with card rendering
- [ ] Implement Card.svelte with basic display
- [ ] Set up Svelte stores for board/card state
- [ ] Implement NIP-100 event creation/parsing

### Phase 2: Bridge Integration (Week 2-3)

- [ ] Add kinds 30301, 30302 to `NIP100_ALLOWED_KINDS` in bridge.ts
- [ ] Implement `nostr:query` filtering for boards scoped to repo
- [ ] Implement `nostr:publish` for board/card creation
- [ ] Add `storage:*` handlers for local board preferences
- [ ] Test bidirectional communication

### Phase 3: Issue/Patch Linking (Week 3-4)

- [ ] Implement issue search/picker for card linking
- [ ] Implement patch search/picker for card linking
- [ ] Derive card status from linked issue/patch status events
- [ ] Display inherited labels from NIP-32 events
- [ ] Real-time subscription for linked item updates

### Phase 4: Advanced Features (Week 4-5)

- [ ] Drag-and-drop card reordering within columns
- [ ] Drag-and-drop column reordering
- [ ] Card filtering by assignee, priority, labels
- [ ] Due date visualization and reminders
- [ ] Board templates (Sprint, Kanban, Custom)

### Phase 5: Polish and Release (Week 5-6)

- [ ] Responsive design for mobile
- [ ] Keyboard navigation
- [ ] Performance optimization for large boards
- [ ] Documentation and user guide
- [ ] Publish extension manifest to relays

---

## UI Mockup

```
+------------------------------------------------------------------+
| [Sprint Board]                           [+ Add Column] [Settings]|
+------------------------------------------------------------------+
|                                                                   |
| +------------+  +------------+  +------------+  +------------+    |
| |  Backlog   |  |   To Do    |  |In Progress |  |    Done    |    |
| |   (5)      |  |    (3)     |  |    (2)     |  |    (8)     |    |
| +------------+  +------------+  +------------+  +------------+    |
| |            |  |            |  |            |  |            |    |
| | +--------+ |  | +--------+ |  | +--------+ |  | +--------+ |    |
| | | Card 1 | |  | | Card 4 | |  | | Card 7 | |  | | Card 9 | |    |
| | | #123   | |  | | #126   | |  | | #128   | |  | | #130   | |    |
| | | @alice | |  | | @bob   | |  | | @carol | |  | | @dave  | |    |
| | +--------+ |  | +--------+ |  | +--------+ |  | +--------+ |    |
| |            |  |            |  |            |  |            |    |
| | +--------+ |  | +--------+ |  | +--------+ |  | +--------+ |    |
| | | Card 2 | |  | | Card 5 | |  | | Card 8 | |  | | Card 10| |    |
| | | Patch  | |  | |        | |  | |        | |  | |        | |    |
| | +--------+ |  | +--------+ |  | +--------+ |  | +--------+ |    |
| |            |  |            |  |            |  |            |    |
| | [+ Card]   |  | [+ Card]   |  | [+ Card]   |  | [+ Card]   |    |
| +------------+  +------------+  +------------+  +------------+    |
+------------------------------------------------------------------+
```

---

## Technical Considerations

### State Synchronization

1. **Optimistic Updates**: Apply card moves immediately, sync in background
2. **Conflict Resolution**: Last-write-wins based on `created_at` timestamp
3. **Offline Support**: Queue events for publish when reconnected

### Performance

1. **Virtual Scrolling**: For columns with many cards
2. **Lazy Loading**: Load cards per column on scroll
3. **Event Caching**: Use repository cache for board/card events

### Security

1. **Maintainer Permissions**: Only repo maintainers can create/modify boards
2. **Card Authorship**: Cards track original author vs. last editor
3. **Bridge Validation**: All nostr:publish calls validate against allowed kinds

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@dnd-kit/core` | Drag-and-drop functionality |
| `@welshman/util` | Nostr event utilities |
| `nostr-tools` | Event signing/verification |

---

## Success Metrics

- [ ] Board loads in < 500ms
- [ ] Drag-and-drop feels instant (< 100ms visual feedback)
- [ ] Supports 100+ cards per board without lag
- [ ] Works offline with sync on reconnect
- [ ] Extension size < 200KB gzipped

---

## Open Questions

1. Should board creation be restricted to repo maintainers only?
2. How to handle archived/closed cards - separate archive column or hide?
3. Support for multiple boards per repository?
4. Card templates for common workflows?
5. Integration with CI/CD pipeline status?

---

## References

- [NIP-100 Kanbanstr Draft](https://github.com/nostr-protocol/nips/discussions/xxx)
- [NIP-34 Git Stuff](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [NIP-32 Labels](https://github.com/nostr-protocol/nips/blob/master/32.md)
- [Flotilla Extension Guide](../extensions/README.md)
