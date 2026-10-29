import { Capacitor, registerPlugin } from '@capacitor/core';

type SecureKeyStorePlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  getKey(): Promise<{ key: string }>;
  setKey(options: { key: string }): Promise<void>;
  clearKey(): Promise<void>;
};

const SecureKeyStore = registerPlugin<SecureKeyStorePlugin>('SecureKeyStore');

/**
 * Android 用 Keystore AES-GCM；浏览器开发环境没有 Keystore，
 * 只用 sessionStorage 临时顶一下（关掉页面就没了，不会落盘）。
 */
const WEB_FALLBACK_KEY = 'expiry-keeper:session-api-key';

export const isSecureStoreNative = (): boolean => Capacitor.isNativePlatform();

export async function readSecureKey(): Promise<string> {
  try {
    if (isSecureStoreNative()) {
      const result = await SecureKeyStore.getKey();
      return (result.key ?? '').trim();
    }
    return (sessionStorage.getItem(WEB_FALLBACK_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export async function writeSecureKey(key: string): Promise<void> {
  const normalized = key.trim();
  if (isSecureStoreNative()) {
    await SecureKeyStore.setKey({ key: normalized });
    return;
  }
  if (normalized) sessionStorage.setItem(WEB_FALLBACK_KEY, normalized);
  else sessionStorage.removeItem(WEB_FALLBACK_KEY);
}

export async function clearSecureKey(): Promise<void> {
  try {
    if (isSecureStoreNative()) await SecureKeyStore.clearKey();
    else sessionStorage.removeItem(WEB_FALLBACK_KEY);
  } catch {
    // 清理失败不阻塞「清空全部数据」
  }
}
