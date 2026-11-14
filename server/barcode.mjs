import { sanitizeCleanedProduct } from './validation.mjs';

const DEFAULT_ENDPOINT = 'https://jisutxmcx.market.alicloudapi.com/barcode2/query';

function packageGrams(value) {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g)/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  return /千克|公斤|kg/i.test(match[2]) ? amount * 1000 : amount;
}

export function mapJisuBarcodeProduct(result, requestedBarcode) {
  if (!result || typeof result !== 'object') return undefined;
  return sanitizeCleanedProduct(
    {
      barcode: requestedBarcode,
      name: result.name || result.ename,
      brand: result.brand,
      brandOwner: result.company,
      packageGrams: packageGrams(result.netweight || result.netcontent),
    },
    requestedBarcode,
  );
}

export function createBarcodeLookup({
  appCode,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
  timeoutMs = 1800,
  cacheTtlMs = 10 * 60_000,
  now = Date.now,
} = {}) {
  if (!appCode) return undefined;
  const cache = new Map();

  return async (barcode) => {
    const cached = cache.get(barcode);
    if (cached && cached.expiresAt > now()) return cached.product;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(endpoint);
      url.searchParams.set('barcode', barcode);
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `APPCODE ${appCode}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`条码接口返回 ${response.status}`);
      const payload = await response.json();
      const product = payload?.status === 0 ? mapJisuBarcodeProduct(payload.result, barcode) : undefined;
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(barcode, { product, expiresAt: now() + cacheTtlMs });
      return product;
    } finally {
      clearTimeout(timer);
    }
  };
}
