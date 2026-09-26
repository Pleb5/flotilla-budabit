import type {RepoCiWatcher} from 'budabit-sdk';

export const FALLBACK_CI_WATCHER = {
  pubkey: 'f814c1976ca05431081e0b27e2a190c379e8e4b25477c7f431fe58e8a7fa9551',
  relays: ['wss://relay.budabit.club/', 'wss://relay.contextvm.org/', 'wss://relay2.contextvm.org/'],
  label: 'Arjen’s watcher (fallback)',
};

export type CiWatcherChoice = {
  pubkey: string;
  relays: string[];
  label: string;
  community?: RepoCiWatcher;
};

export function ciWatcherChoices(watchers: RepoCiWatcher[] = []): CiWatcherChoice[] {
  const choices = watchers.map(community => ({
    pubkey: community.pubkey,
    relays: [...community.relays],
    label: `${community.communityName} · ${community.repoMatch ? 'repo community · ' : ''}${community.role} · ${community.pubkey.slice(0, 8)}`,
    community,
  }));
  return choices.some(choice => choice.pubkey === FALLBACK_CI_WATCHER.pubkey)
    ? choices : [...choices, FALLBACK_CI_WATCHER];
}

/** A manual selection wins until removed from the eligible set. Without one,
 * progressive host hydration can promote a stronger default automatically. */
export function selectCiWatcher(choices: CiWatcherChoice[], manualPubkey?: string | null): CiWatcherChoice {
  return choices.find(choice => choice.pubkey === manualPubkey) || choices[0] || FALLBACK_CI_WATCHER;
}
