# Slot System

Documentation for the Flotilla Smart Widget slot system, which defines where widgets can be mounted in the host application.

## Overview

Slots are designated areas in the Flotilla host UI where widgets can be rendered. Each slot has specific characteristics:

- **Location** - Where in the UI the widget appears
- **Size constraints** - Viewport dimensions available to the widget
- **Context** - What data is available (e.g., repository, room, user)
- **Interaction model** - How users interact with the widget

Widgets declare their target slot(s) in the manifest, and the host renders them in the appropriate location.

## Available Slots

### `chat:composer:actions`

Action buttons in the chat message composer area.

**Location:** Next to the send button in chat input
**Size:** Icon button (typically 32x32px)
**Context:** Current room, active conversation

**Use cases:**
- Insert templates or snippets
- Attach files or media
- Trigger AI assistance
- Add formatting options

**Example manifest:**

```json
{
  "slot": "chat:composer:actions"
}
```

### `chat:message:actions`

Action buttons that appear on individual chat messages.

**Location:** Message hover/context menu
**Size:** Icon button (typically 24x24px)
**Context:** Current room, specific message

**Use cases:**
- React to messages
- Translate messages
- Copy or share
- Report or moderate

**Example manifest:**

```json
{
  "slot": "chat:message:actions"
}
```

### `room:header:actions`

Action buttons in the room/channel header.

**Location:** Top-right of room header
**Size:** Icon button (typically 32x32px)
**Context:** Current room

**Use cases:**
- Room settings
- Search within room
- Pin/bookmark room
- Room-specific integrations

**Example manifest:**

```json
{
  "slot": "room:header:actions"
}
```

### `room:panel`

Side panel within a room view.

**Location:** Right side panel in room view
**Size:** Panel (typically 300-400px width, full height)
**Context:** Current room, messages

**Use cases:**
- Thread views
- Participant list
- Room info and settings
- File browser
- Search results

**Example manifest:**

```json
{
  "slot": "room:panel"
}
```

### `global:menu`

Entry in the global application menu.

**Location:** Main navigation menu
**Size:** Menu item with optional icon
**Context:** Application-wide

**Use cases:**
- Settings pages
- User profile
- Global search
- Help and documentation

**Example manifest:**

```json
{
  "slot": "global:menu"
}
```

### `settings:panel`

Panel within the application settings.

**Location:** Settings page section
**Size:** Full settings panel width
**Context:** User settings, widget configuration

**Use cases:**
- Widget configuration UI
- Account connections
- Preferences
- Data management

**Example manifest:**

```json
{
  "slot": "settings:panel"
}
```

### `space:sidebar:widgets`

Widget area in the space/workspace sidebar.

**Location:** Sidebar below navigation
**Size:** Sidebar width (typically 250-300px), variable height
**Context:** Current space/workspace

**Use cases:**
- Quick actions
- Status displays
- Notifications
- Bookmarks and favorites

**Example manifest:**

```json
{
  "slot": "space:sidebar:widgets"
}
```

## Repository Tab Slot

The `repo-tab` slot type creates a full tab in the repository view, allowing for rich, full-page widget experiences.

### Configuration

```typescript
interface RepoTabSlot {
  type: "repo-tab";

  /** Display label for the tab */
  label: string;

  /** URL path segment for the tab (e.g., "/my-widget" -> repo/owner/name/my-widget) */
  path: string;

  /** Optional: replace a built-in route instead of adding a new tab */
  builtinRoute?: string;
}
```

### Basic Example

```json
{
  "slot": {
    "type": "repo-tab",
    "label": "Analytics",
    "path": "/analytics"
  }
}
```

This creates a new tab labeled "Analytics" accessible at `/repo/{owner}/{name}/analytics`.

### Replacing Built-in Routes

Use `builtinRoute` to replace a standard repository route with your widget:

```json
{
  "slot": {
    "type": "repo-tab",
    "label": "Enhanced Issues",
    "path": "/issues",
    "builtinRoute": "issues"
  }
}
```

**Available built-in routes:**
- `issues` - Issue tracker
- `pulls` - Pull requests
- `wiki` - Repository wiki
- `settings` - Repository settings
- `actions` - workflows
- `projects` - Project boards

### Complete Repo Tab Example

```typescript
// manifest configuration
const manifest = {
  kind: 30033,
  content: "Repository Analytics Dashboard",
  tags: [
    ["d", "repo-analytics"],
    ["l", "tool"],
    ["slot", JSON.stringify({
      type: "repo-tab",
      label: "Analytics",
      path: "/analytics"
    })],
    ["icon", "https://cdn.example.com/analytics-icon.png"],
    ["button", "Open", "app", "https://cdn.example.com/analytics/index.html"],
    ["permission", "storage:get"],
    ["permission", "storage:set"]
  ]
};
```

## Slot Declaration in Manifest

### Single Slot

```json
{
  "kind": 30033,
  "tags": [
    ["d", "my-widget"],
    ["l", "tool"],
    ["slot", "chat:composer:actions"],
    ["button", "Open", "app", "https://example.com/widget.html"]
  ]
}
```

### Multiple Slots

Widgets can declare multiple slots to appear in different locations:

```json
{
  "kind": 30033,
  "tags": [
    ["d", "my-widget"],
    ["l", "tool"],
    ["slot", "chat:composer:actions"],
    ["slot", "room:header:actions"],
    ["button", "Open", "app", "https://example.com/widget.html"]
  ]
}
```

### Slot with Configuration

For slots that require additional configuration (like `repo-tab`):

```json
{
  "kind": 30033,
  "tags": [
    ["d", "my-widget"],
    ["l", "tool"],
    ["slot", "{\"type\":\"repo-tab\",\"label\":\"Dashboard\",\"path\":\"/dashboard\"}"],
    ["button", "Open", "app", "https://example.com/widget.html"]
  ]
}
```

## TypeScript Types

```typescript
/** Simple slot types */
export type SimpleSlot =
  | 'chat:composer:actions'
  | 'chat:message:actions'
  | 'room:header:actions'
  | 'room:panel'
  | 'global:menu'
  | 'settings:panel'
  | 'space:sidebar:widgets';

/** Repo tab slot configuration */
export interface RepoTabSlot {
  type: 'repo-tab';
  label: string;
  path: string;
  builtinRoute?: string;
}

/** All slot types */
export type WidgetSlot = SimpleSlot | RepoTabSlot;

/** Parse slot from manifest tag */
export function parseSlot(tagValue: string): WidgetSlot {
  // Try to parse as JSON (for repo-tab config)
  try {
    const parsed = JSON.parse(tagValue);
    if (parsed.type === 'repo-tab') {
      return parsed as RepoTabSlot;
    }
  } catch {
    // Not JSON, treat as simple slot string
  }

  return tagValue as SimpleSlot;
}
```

## Slot Context

Each slot provides different context to the widget via the `widget:init` event:

| Slot | Context Available |
|------|-------------------|
| `chat:composer:actions` | Room, user |
| `chat:message:actions` | Room, message, user |
| `room:header:actions` | Room, user |
| `room:panel` | Room, messages, user |
| `global:menu` | User |
| `settings:panel` | User, widget config |
| `space:sidebar:widgets` | Space, user |
| `repo-tab` | Repository, user |

### Accessing Slot Context

```typescript
bridge.onEvent('widget:init', (payload) => {
  // Always available
  console.log('Extension ID:', payload.extensionId);
  console.log('Host version:', payload.hostVersion);

  // Available in repo-scoped slots
  if (payload.repoContext) {
    console.log('Repository:', payload.repoContext.fullName);
  }

  // Available in room-scoped slots
  if (payload.roomContext) {
    console.log('Room:', payload.roomContext.roomId);
  }

  // Available in message-action slots
  if (payload.messageContext) {
    console.log('Message:', payload.messageContext.messageId);
  }
});
```

## Responsive Design

Widgets should adapt to the size constraints of their slot:

```typescript
bridge.onEvent('widget:mounted', (payload) => {
  if (payload.viewport) {
    const { width, height } = payload.viewport;

    // Adjust layout based on available space
    if (width < 300) {
      // Compact mode for narrow slots
      setCompactMode(true);
    } else {
      // Full mode for wider slots
      setCompactMode(false);
    }
  }
});
```

### Slot Size Guidelines

| Slot | Typical Width | Typical Height |
|------|--------------|----------------|
| `*:actions` | 24-48px | 24-48px |
| `room:panel` | 300-400px | Full viewport |
| `settings:panel` | 600-800px | Variable |
| `space:sidebar:widgets` | 250-300px | Variable |
| `repo-tab` | Full viewport | Full viewport |

## Best Practices

1. **Design for the slot** - Consider the size and context of your target slot
2. **Handle multiple slots** - If your widget supports multiple slots, detect which one it's in
3. **Graceful degradation** - Work with missing context (not all slots provide all data)
4. **Responsive layouts** - Adapt to viewport constraints provided at mount
5. **Clear slot selection** - Choose the most appropriate slot(s) for your widget's purpose

## Related Documentation

- [Lifecycle Events](./lifecycle.md)
- [Manifest Reference](./manifest.md)
- [Architecture Overview](./architecture.md)
