import { Capacitor, registerPlugin } from '@capacitor/core';

type SecureKeyStorePlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  getKey(options: { slot: SecureSlot }): Promise<{ key: string }>;
  setKey(options: { key: string; slot: SecureSlot }): Promise<void>;
  clearKey(options?: { slot?: SecureSlot }): Promise<void>;
};

const SecureKeyStore = registerPlugin<SecureKeyStorePlugin>('SecureKeyStore');
export type SecureSlot = 'apiKey' | 'productHmac';

/**
 * Android 用 Keystore AES-GCM；浏览器开发环境没有 Keystore，
 * 只用 sessionStorage 临时顶一下（关掉页面就没了，不会落盘）。
 */
const WEB_FALLBACK_KEYS: Record<SecureSlot, string> = {
  apiKey: 'expiry-keeper:session-api-key',
  productHmac: 'expiry-keeper:session-product-hmac',
};

export const isSecureStoreNative = (): boolean => Capacitor.isNativePlatform();

export async function readSecureKey(slot: SecureSlot = 'apiKey'): Promise<string> {
  try {
    if (isSecureStoreNative()) {
      const result = await SecureKeyStore.getKey({ slot });
      return (result.key ?? '').trim();
    }
    return (sessionStorage.getItem(WEB_FALLBACK_KEYS[slot]) ?? '').trim();
  } catch {
    return '';
  }
}

export async function writeSecureKey(key: string, slot: SecureSlot = 'apiKey'): Promise<void> {
  const normalized = key.trim();
  if (isSecureStoreNative()) {
    await SecureKeyStore.setKey({ key: normalized, slot });
    return;
  }
  if (normalized) sessionStorage.setItem(WEB_FALLBACK_KEYS[slot], normalized);
  else sessionStorage.removeItem(WEB_FALLBACK_KEYS[slot]);
}

export async function clearSecureKey(slot?: SecureSlot): Promise<void> {
  try {
    if (isSecureStoreNative()) {
      await SecureKeyStore.clearKey(slot ? { slot } : {});
      return;
    }
    const slots: SecureSlot[] = slot ? [slot] : ['apiKey', 'productHmac'];
    slots.forEach((entry) => sessionStorage.removeItem(WEB_FALLBACK_KEYS[entry]));
  } catch {
    // 清理失败不阻塞「清空全部数据」
  }
}
