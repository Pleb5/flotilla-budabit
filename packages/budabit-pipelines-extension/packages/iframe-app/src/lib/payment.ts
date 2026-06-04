export async function parseCashuTokenAmount(token: string): Promise<number> {
  const mod = await import('@cashu/cashu-ts')
  const decoded = mod.getDecodedToken(token)
  return decoded.proofs.reduce((sum, proof) => sum + proof.amount, 0)
}
