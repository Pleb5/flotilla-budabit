import { createWidgetBridge, type WidgetBridge } from '@flotilla/ext-shared';
import { getHostOrigin, transformHostContext } from './context';
import type { RepoContext } from './types';

interface WidgetLifecycleArgs {
  onBridgeChange: (bridge: WidgetBridge | null) => void;
  onRepoContextChange: (repoContext: RepoContext | null) => void;
  onRepoChange: () => void;
  onUnmount: () => void;
}

/**
 * Actively request repo context from the host via context:getRepo.
 * This is the reliable fallback when the host's context:update event
 * is lost due to a timing race (event fires before listeners are ready).
 */
async function fetchRepoContext(bridge: WidgetBridge): Promise<unknown | null> {
  try {
    const res: any = await bridge.request('context:getRepo', {});
    if (res && typeof res === 'object' && res.status === 'ok' && res.repoContext) {
      return res.repoContext;
    }
    return null;
  } catch {
    // Host may not support this action — that's fine, we'll wait for events.
    return null;
  }
}

export function setupWidgetLifecycle(args: WidgetLifecycleArgs) {
  const { onBridgeChange, onRepoContextChange, onRepoChange, onUnmount } = args;

  let contextReceived = false;

  const bridge = createWidgetBridge({
    targetWindow: window.parent,
    targetOrigin: getHostOrigin(),
    timeoutMs: 15_000,
  });

  onBridgeChange(bridge);

  const handleRepoContext = (input: unknown, options: { resetRunState: boolean }) => {
    contextReceived = true;
    const nextRepoCtx = input ? transformHostContext(input) : null;
    onRepoContextChange(nextRepoCtx);
    if (options.resetRunState) {
      onRepoChange();
    }
  };

  const offInit = bridge.onEvent('widget:init', (payload: any) => {
    if (payload?.repoContext) {
      handleRepoContext(payload.repoContext, { resetRunState: false });
    }
  });

  const offUnmounting = bridge.onEvent('widget:unmounting', () => {
    onUnmount();
  });

  const offContext = bridge.onEvent('context:update', (ctx: any) => {
    handleRepoContext(ctx, { resetRunState: true });
  });

  const offRepoUpdate = bridge.onEvent('context:repoUpdate', (ctx: any) => {
    handleRepoContext(ctx, { resetRunState: true });
  });

  // Actively fetch context, in case the host's context:update event was sent
  // before our listeners were registered (e.g. after an HMR reload, where the
  // host sees no fresh iframe `load` and never re-pushes). A single attempt can
  // miss it — the host's repoContext may not be populated yet, or the reply can
  // be dropped — so we poll until context arrives or we exhaust our attempts.
  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const POLL_INTERVAL_MS = 1000;
  const MAX_ATTEMPTS = 10;
  let attempts = 0;

  const poll = () => {
    if (cancelled || contextReceived) return;
    if (attempts >= MAX_ATTEMPTS) return;
    attempts += 1;
    void fetchRepoContext(bridge).then((ctx) => {
      if (cancelled || contextReceived) return; // event arrived while fetching
      if (ctx) {
        handleRepoContext(ctx, { resetRunState: false });
        return;
      }
      // No context yet (host repo not ready, or reply dropped) — retry.
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    });
  };
  pollTimer = setTimeout(poll, 500);

  return () => {
    cancelled = true;
    if (pollTimer) clearTimeout(pollTimer);
    offInit();
    offUnmounting();
    offContext();
    offRepoUpdate();
    bridge.destroy();
    onBridgeChange(null);
  };
}
