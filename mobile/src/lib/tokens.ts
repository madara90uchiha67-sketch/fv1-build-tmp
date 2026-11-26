import * as SecureStore from "expo-secure-store";

// Los tokens viven solo en el almacenamiento seguro nativo (Android Keystore). Nunca en AsyncStorage ni en el bundle.
const K_ACCESS = "founder.accessToken";
const K_REFRESH = "founder.refreshToken";
const K_EXPIRES = "founder.accessExpiresAt";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Marca de tiempo (ms) en la que caduca el token de acceso. */
  expiresAt: number;
}

let cache: Tokens | null = null;
let loaded = false;

export async function loadTokens(): Promise<Tokens | null> {
  if (loaded) return cache;
  try {
    const [accessToken, refreshToken, expires] = await Promise.all([
      SecureStore.getItemAsync(K_ACCESS),
      SecureStore.getItemAsync(K_REFRESH),
      SecureStore.getItemAsync(K_EXPIRES),
    ]);
    cache = accessToken && refreshToken ? { accessToken, refreshToken, expiresAt: Number(expires) || 0 } : null;
  } catch {
    cache = null;
  }
  loaded = true;
  return cache;
}

export async function saveTokens(tokens: Tokens): Promise<void> {
  cache = tokens;
  loaded = true;
  await Promise.all([
    SecureStore.setItemAsync(K_ACCESS, tokens.accessToken),
    SecureStore.setItemAsync(K_REFRESH, tokens.refreshToken),
    SecureStore.setItemAsync(K_EXPIRES, String(tokens.expiresAt)),
  ]);
}

export async function clearTokens(): Promise<void> {
  cache = null;
  loaded = true;
  await Promise.all(
    [K_ACCESS, K_REFRESH, K_EXPIRES].map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)),
  );
}
