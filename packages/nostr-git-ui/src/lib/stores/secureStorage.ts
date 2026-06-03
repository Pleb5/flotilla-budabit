type EncryptFn = (plaintext: string) => Promise<string>;
type DecryptFn = (ciphertext: string) => Promise<string>;

export function createSecureStorage(storageKey: string, encrypt: EncryptFn, decrypt: DecryptFn) {
  async function saveToken(token: string) {
    const encrypted = await encrypt(token);
    localStorage.setItem(storageKey, encrypted);
  }

  async function loadToken(): Promise<string | null> {
    const encrypted = localStorage.getItem(storageKey);
    if (!encrypted) return null;
    try {
      return await decrypt(encrypted);
    } catch (e) {
      console.error("Token decryption failed", e);
      return null;
    }
  }

  function clearToken() {
    localStorage.removeItem(storageKey);
  }

  return {
    saveToken,
    loadToken,
    clearToken,
  };
}
