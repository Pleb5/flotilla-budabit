# budabit-sdk

SDK for building [Budabit](https://budabit.com) Smart Widget extensions.

## Install

```bash
npm install budabit-sdk
```

## Usage

### Bridge (iframe ↔ host communication)

```ts
import { createWidgetBridge, type WidgetBridge } from 'budabit-sdk';

const bridge = createWidgetBridge({
  targetWindow: window.parent,
  targetOrigin: '*',
});

// Publish a Nostr event
const result = await bridge.request('nostr:publish', {
  kind: 1,
  content: 'Hello from my widget!',
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
});

// Listen for context updates from host
bridge.onEvent('context:update', (ctx) => {
  console.log('Context:', ctx.contextId, ctx.userPubkey);
});

// Cleanup
bridge.destroy();
```

### Manifest CLI

Generate a Smart Widget event (kind 30033):

```bash
npx budabit-generate \
  --title 'My Widget' \
  --type tool \
  --app-url 'https://cdn.example.com/my-widget/index.html' \
  --icon 'https://cdn.example.com/my-widget/icon.png' \
  --image 'https://cdn.example.com/my-widget/preview.png' \
  --permissions 'nostr:publish,nostr:query,nostr:subscribe,community:checkWriteCapabilities,community:queryEvents,community:querySharedConfig,ui:toast' \
  --nostr-kinds '30301,30302'
```

### Programmatic manifest generation

```ts
import { generateSmartWidgetEvent } from 'budabit-sdk/manifest';

const event = generateSmartWidgetEvent({
  title: 'My Widget',
  widgetType: 'tool',
  appUrl: 'https://cdn.example.com/my-widget/index.html',
  iconUrl: 'https://cdn.example.com/my-widget/icon.png',
  imageUrl: 'https://cdn.example.com/my-widget/preview.png',
  permissions: ['nostr:publish', 'ui:toast'],
  nostrKinds: [30301, 30302],
});
```

### Testing

```ts
import { createMockWidgetBridge } from 'budabit-sdk/testing';

const mock = createMockWidgetBridge();

// Simulate widget requesting a publish
const promise = mock.request('nostr:publish', {
  kind: 1,
  content: 'test',
  tags: [],
  created_at: 0,
});

// Simulate host responding
const msg = mock.sentMessages[0];
mock.respondTo(msg.id!, { status: 'ok' });

const result = await promise; // { status: 'ok' }
```

### Worker bridge

```ts
import { createWorkerBridge } from 'budabit-sdk/worker';

const bridge = createWorkerBridge((msg) => self.postMessage(msg));
self.addEventListener('message', (e) => bridge.handleMessage(e.data));
```

## Subpath Exports

| Import                 | Contents                               |
| ---------------------- | -------------------------------------- |
| `budabit-sdk`          | Types, WidgetBridge, signaling helpers |
| `budabit-sdk/manifest` | Event generator, CLI utilities         |
| `budabit-sdk/testing`  | MockWidgetBridge, test helpers         |
| `budabit-sdk/worker`   | Worker bridge                          |

## Scaffold a new widget

```bash
npx create-budabit-widget my-widget
```

## License

MIT
# Visibility contract

See [Visibility before loading](../../docs/visibility.md). Use
`bridge.setVisibility('visible' | 'hidden' | 'pending', communityContext)` only
when `init.capabilities.surface.visibility` and the `ui:setVisibility` action are
advertised. The manifest CLI accepts `--visibility host|widget`. A readiness or
resize message does not establish visibility.
