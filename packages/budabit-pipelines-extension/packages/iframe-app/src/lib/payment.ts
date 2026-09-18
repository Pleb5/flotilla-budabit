export async function parseCashuTokenAmount(token: string): Promise<number> {
  const mod = await import('@cashu/cashu-ts');
  const metadata = mod.getTokenMetadata(token);
  if (metadata.unit !== 'sat') throw new Error('Only sat-denominated tokens are supported');
  // Metadata does not need the mint's full keyset IDs for compact v4 tokens.
  const toNumber = (value: number | { toNumber(): number }) =>
    typeof value === 'number' ? value : value.toNumber();
  const amount = toNumber(metadata.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid token amount');
  return amount;
}
