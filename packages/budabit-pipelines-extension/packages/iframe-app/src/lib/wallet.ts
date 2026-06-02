import type { WidgetBridge } from '@flotilla/ext-shared';

export interface CashuWalletState {
  totalBalance: number;
  balancesByMint: Record<string, number>;
  mints: string[];
}

function isBridgeError(value: unknown): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value && typeof (value as any).error === 'string';
}

export async function loadCashuWalletState(bridge: WidgetBridge): Promise<CashuWalletState> {
  const [balanceResult, mintsResult] = await Promise.all([
    bridge.request('cashu:getBalance', {}),
    bridge.request('cashu:getMints', {}),
  ]);

  if (isBridgeError(balanceResult)) throw new Error(balanceResult.error);
  if (isBridgeError(mintsResult)) throw new Error(mintsResult.error);

  const totalBalance =
    balanceResult && typeof balanceResult === 'object' && 'total' in balanceResult
      ? Number((balanceResult as any).total || 0)
      : 0;

  const balancesByMint =
    balanceResult && typeof balanceResult === 'object' && 'byMint' in balanceResult
      ? ((balanceResult as any).byMint as Record<string, number>)
      : {};

  const mints = Array.isArray(mintsResult)
    ? mintsResult.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];

  return { totalBalance, balancesByMint, mints };
}

export async function createCashuPaymentToken(
  bridge: WidgetBridge,
  amount: number,
  mintUrl: string,
  label: string
): Promise<string> {
  const result = await bridge.request('cashu:createToken', {
    amount,
    mintUrl,
    label,
  });

  if (isBridgeError(result)) throw new Error(result.error);
  if (!result || typeof result !== 'object' || typeof (result as any).token !== 'string') {
    throw new Error('The host did not return a Cashu token.');
  }

  return (result as any).token;
}

/**
 * Redeem an unused Cashu token back into the host wallet. Used to refund the
 * user when a run submission fails after a payment token has already been
 * minted — without this, the value sits in the unsent token string and is
 * effectively lost when the form unmounts.
 */
export async function refundCashuToken(
  bridge: WidgetBridge,
  token: string
): Promise<void> {
  if (!token.trim()) return;
  try {
    const result = await bridge.request('cashu:receiveToken', {token});
    if (isBridgeError(result)) {
      throw new Error(result.error);
    }
  } catch (err) {
    // Don't shadow the original failure that triggered the refund — log so the
    // user can manually paste the token back into the wallet if needed.
    console.error('[wallet] failed to refund payment token; copy this and paste into wallet manually:', token, err);
    throw err;
  }
}
