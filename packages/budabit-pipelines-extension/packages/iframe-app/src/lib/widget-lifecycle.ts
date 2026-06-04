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

  // Actively fetch context after a short delay, in case the host's
  // context:update event was sent before our listeners were registered.
  const fallbackTimer = setTimeout(() => {
    if (contextReceived) return;
    void fetchRepoContext(bridge).then((ctx) => {
      if (contextReceived) return; // event arrived while we were fetching
      if (ctx) {
        handleRepoContext(ctx, { resetRunState: false });
      }
    });
  }, 500);

  return () => {
    clearTimeout(fallbackTimer);
    offInit();
    offUnmounting();
    offContext();
    offRepoUpdate();
    bridge.destroy();
    onBridgeChange(null);
  };
}
