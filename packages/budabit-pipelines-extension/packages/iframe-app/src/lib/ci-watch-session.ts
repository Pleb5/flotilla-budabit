import {extractFollowedRepoAddrs, isUnauthorizedError} from './ci-watch';
import {friendlyErrorMessage} from './context';

export interface CiWatchClient {
  ListFollowed(args: Record<string, never>): Promise<unknown>;
  FollowRepo(address: string, owner?: string, id?: string, relays?: string[]): Promise<unknown>;
  UnfollowRepo(address: string, owner?: string, id?: string, relays?: string[]): Promise<unknown>;
  disconnect(): Promise<void>;
}

export type CiWatchState = {
  status: 'loading' | 'followed' | 'unfollowed' | 'unauthorized' | 'error';
  busy: boolean;
  error?: string;
};

/** One immutable watcher/account/repository lifetime. Disposed sessions cannot
 * update the next selection, show stale success, or start another operation. */
export function createCiWatchSession(
  client: CiWatchClient,
  address: string,
  relays: string[],
  onState: (state: CiWatchState) => void,
) {
  let active = true;
  let state: CiWatchState = {status: 'loading', busy: false};
  const update = (next: CiWatchState) => { if (active) onState(state = next); };
  const failure = (error: unknown) => update({
    status: isUnauthorizedError(error) ? 'unauthorized' : 'error', busy: false,
    error: friendlyErrorMessage(error instanceof Error ? error.message : String(error)),
  });
  update(state);
  void client.ListFollowed({}).then(output => update({
    status: extractFollowedRepoAddrs(output).includes(address) ? 'followed' : 'unfollowed', busy: false,
  }), failure);

  return {
    async toggle() {
      if (!active || state.busy || !['followed', 'unfollowed'].includes(state.status)) return;
      const follow = state.status === 'unfollowed';
      update({...state, busy: true});
      try {
        if (follow) await client.FollowRepo(address, undefined, undefined, relays);
        else await client.UnfollowRepo(address, undefined, undefined, relays);
        update({status: follow ? 'followed' : 'unfollowed', busy: false});
      } catch (error) { failure(error); }
    },
    dispose() {
      active = false;
      void client.disconnect().catch(() => undefined);
    },
  };
}
