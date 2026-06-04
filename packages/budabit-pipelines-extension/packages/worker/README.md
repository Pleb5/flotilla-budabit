# @flotilla/ext-worker

Headless worker bridge for Flotilla extensions.

## Purpose

This package provides a worker-based bridge for extensions that need to run background logic without DOM access. Use cases include:

- Service worker integration
- Background processing
- Headless signaling coordination
- Testing without browser environment

## Usage

### In a Web Worker

```typescript
import { createWorkerBridge } from '@flotilla/ext-worker';

const bridge = createWorkerBridge((message) => {
  self.postMessage(message);
});

self.addEventListener('message', (event) => {
  bridge.handleMessage(event.data);
});

// Send ready signal
bridge.send({ type: 'ready' });
```

### From the Host

```typescript
const worker = new Worker('/worker.js');

worker.postMessage({
  type: 'config',
  config: {
    contextId: 'room-123',
    userPubkey: 'abc...',
  },
});

worker.addEventListener('message', (event) => {
  console.log('Worker sent:', event.data);
});
```

## Status

⚠️ **Stubbed Implementation**

This package is currently a stub. Uncomment and customize the worker code in `src/index.ts` to enable it for your extension.

## Building

```bash
pnpm --filter @flotilla/ext-worker build
```
