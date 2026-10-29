import type { PantryItem, PetCategory, Settings, Sku } from '../types';
import { buildChecks } from './engine';
import {
  PRODUCT_API_HMAC_SECRET,
  PRODUCT_API_TIMEOUT_MS,
  PRODUCT_USER_HASH_SALT,
} from './config';
import { refreshSku } from './sku';
import type { RecognizeOutcome } from '../types';
import { Capacitor } from '@capacitor/core';

export type LibraryProduct = {
  barcode: string;
  name: string;
  brand: string;
  manufacturer: string;
  category?: PetCategory;
  kind?: 'staple' | 'snack';
  ingredientsRaw: string;
  shelfLifeMonths?: number;
  packageGrams?: number;
  nutrition?: Sku['nutrition'];
  verified?: boolean;
  verifiedFields?: string[];
  humanConfirmed?: boolean;
  updatedAt?: number;
};

export type ProductLookupResult =
  | { status: 'disabled' }
  | { status: 'miss' }
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'hit'; product: LibraryProduct; elapsedMs: number };

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function nonce(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replaceAll('-', '');
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function signedHeaders(
  method: string,
  path: string,
  body: string,
  secret = PRODUCT_API_HMAC_SECRET,
): Promise<Record<string, string>> {
  const timestamp = String(Date.now());
  const requestNonce = nonce();
  const signature = await hmac(
    secret,
    [method.toUpperCase(), path, timestamp, requestNonce, await sha256(body)].join('\n'),
  );
  return {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Nonce': requestNonce,
    'X-Signature': signature,
  };
}

function productEndpoint(settings: Settings, barcode: string): URL | undefined {
  const base = settings.productApiUrl?.trim();
  if (!base) return undefined;
  try {
    const url = new URL(`/api/v1/product/${encodeURIComponent(barcode)}`, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export async function lookupProduct(
  settings: Settings,
  barcode: string,
  options: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    hmacSecret?: string;
  } = {},
): Promise<ProductLookupResult> {
  const url = productEndpoint(settings, barcode);
  if (!url) return { status: 'disabled' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PRODUCT_API_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const headers = await signedHeaders('GET', `${url.pathname}${url.search}`, '', options.hmacSecret);
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (response.status === 404) return { status: 'miss' };
    if (!response.ok) return { status: 'error', message: `查询库返回 ${response.status}` };
    const payload = await response.json();
    if (!payload?.found || !payload?.product?.name) return { status: 'miss' };
    return {
      status: 'hit',
      product: payload.product as LibraryProduct,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { status: 'timeout' };
    return { status: 'error', message: error instanceof Error ? error.message : '查询库请求失败' };
  } finally {
    clearTimeout(timer);
  }
}

function shelfLifeText(months: number | undefined): string | undefined {
  if (!months || months <= 0) return undefined;
  return months % 12 === 0 ? `${months / 12}年` : `${months}个月`;
}

export function libraryOutcome(product: LibraryProduct, barcode: string): RecognizeOutcome {
  const score = product.verified || product.humanConfirmed ? 1 : 0.6;
  const sku = refreshSku({
    gtin: product.barcode || barcode,
    name: product.name,
    brand: product.brand || '',
    manufacturer: product.manufacturer || '',
    ingredientsRaw: product.ingredientsRaw || '',
    ingredients: [],
    additives: [],
    allergens: [],
    category: product.category,
    kind: product.kind,
    shelfLifeMonths: product.shelfLifeMonths,
    shelfLifeText: shelfLifeText(product.shelfLifeMonths),
    packageGrams: product.packageGrams,
    nutrition: product.nutrition,
    source: 'library',
    version: 1,
    confidence: {
      name: score,
      brand: score,
      manufacturer: score,
      ingredientsRaw: score,
      shelfLifeText: score,
    },
    verified: Boolean(product.verified),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return {
    sku,
    engine: 'library',
    notices: [
      product.verified || product.humanConfirmed
        ? '已命中商品查询库的可信档案，仍请按包装核对'
        : '已命中商品查询库的待验证档案，请重点核对字段',
    ],
    checks: buildChecks(sku, { gtin: sku.gtin }),
  };
}

async function installationUserHash(): Promise<string> {
  const storageKey = 'expiry-keeper:installation-id';
  let deviceId = '';
  if (Capacitor.isNativePlatform()) {
    try {
      const { Device } = await import('@capacitor/device');
      deviceId = (await Device.getId()).identifier;
    } catch {
      deviceId = '';
    }
  }
  if (!deviceId) {
    deviceId = localStorage.getItem(storageKey) ?? '';
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(storageKey, deviceId);
    }
  }
  return sha256(`${deviceId}:${PRODUCT_USER_HASH_SALT}`);
}

export async function contributeProduct(
  settings: Settings,
  sku: Sku,
  item?: PantryItem,
  options: { fetchImpl?: typeof fetch; hmacSecret?: string } = {},
): Promise<boolean> {
  const base = settings.productApiUrl?.trim();
  if (!base || !sku.gtin) return false;
  let url: URL;
  try {
    url = new URL('/api/v1/contribute', base);
  } catch {
    return false;
  }
  const body = JSON.stringify({
    barcode: sku.gtin,
    user_hash: await installationUserHash(),
    product: {
      name: sku.name,
      brand: sku.brand,
      manufacturer: sku.manufacturer,
      category: sku.category,
      kind: sku.kind,
      ingredientsRaw: sku.ingredientsRaw,
      storage: sku.storage,
      shelfLifeText: sku.shelfLifeText,
      shelfLifeMonths: sku.shelfLifeMonths,
      packageGrams: sku.packageGrams,
      nutrition: sku.nutrition,
      productionDate: item?.productionDate,
      expiryDate: item?.expiryDate,
      expiryHumanConfirmed: item?.expiryHumanConfirmed === true,
    },
  });
  try {
    const headers = await signedHeaders('POST', `${url.pathname}${url.search}`, body, options.hmacSecret);
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body,
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

