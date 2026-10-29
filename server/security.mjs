import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value) {
  return createHash('sha256').update(value ?? '').digest('hex');
}

export function requestSignature(secret, { method, path, timestamp, nonce, body = '' }) {
  const canonical = [
    String(method || 'GET').toUpperCase(),
    path,
    String(timestamp),
    String(nonce),
    sha256Hex(body),
  ].join('\n');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left ?? '', 'utf8');
  const b = Buffer.from(right ?? '', 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHmacMiddleware({ secret, maxSkewMs = 5 * 60_000, now = Date.now }) {
  const seenNonces = new Map();
  return (req, res, next) => {
    if (!secret) return res.status(503).json({ error: '服务端未配置 HMAC_SECRET' });
    const timestamp = String(req.get('x-timestamp') ?? '');
    const nonce = String(req.get('x-nonce') ?? '');
    const signature = String(req.get('x-signature') ?? '');
    const issuedAt = Number(timestamp);
    if (!Number.isFinite(issuedAt) || Math.abs(now() - issuedAt) > maxSkewMs) {
      return res.status(401).json({ error: '请求时间戳无效或已过期' });
    }
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(nonce)) {
      return res.status(400).json({ error: '缺少有效请求 nonce' });
    }
    if (seenNonces.has(nonce)) return res.status(409).json({ error: '重复请求' });
    const body = req.rawBody ? req.rawBody.toString('utf8') : '';
    const expected = requestSignature(secret, {
      method: req.method,
      path: req.originalUrl,
      timestamp,
      nonce,
      body,
    });
    if (!safeEqual(expected, signature)) return res.status(401).json({ error: 'HMAC 签名不匹配' });
    seenNonces.set(nonce, issuedAt);
    for (const [entry, at] of seenNonces) {
      if (now() - at > maxSkewMs * 2) seenNonces.delete(entry);
    }
    next();
  };
}

export function basicAuthPassword(header) {
  if (!header?.startsWith('Basic ')) return '';
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return decoded.slice(decoded.indexOf(':') + 1);
  } catch {
    return '';
  }
}
