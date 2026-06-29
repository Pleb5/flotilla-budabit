export const validateNewPassphrase = (passphrase: string, confirm: string) => {
  if (passphrase.length < 12) return "Use an encryption passphrase of at least 12 characters."
  if (passphrase !== confirm) return "Encryption passphrases do not match."
  return ""
}
