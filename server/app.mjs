import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import {
  cacheExternalProduct,
  enqueueContribution,
  getProduct,
  productCounts,
  searchProducts,
  setProductStatus,
  updateProductAsAdmin,
} from './db.mjs';
import { createHmacMiddleware, basicAuthPassword } from './security.mjs';
import {
  LIMITS,
  normalizeBarcode,
  normalizeNutrition,
  sanitizeCleanedProduct,
  text,
  validateContributionBody,
  validUserHash,
} from './validation.mjs';

const defaultReleaseDir = fileURLToPath(new URL('../release/', import.meta.url));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function sanitizedContribution(rawProduct) {
  return {
    name: text(rawProduct.name, LIMITS.name),
    brand: text(rawProduct.brand, LIMITS.brand),
    brandOwner: text(rawProduct.brandOwner, LIMITS.brandOwner),
    manufacturer: text(rawProduct.manufacturer, LIMITS.manufacturer),
    category: rawProduct.category,
    kind: rawProduct.kind,
    ingredientsRaw: text(rawProduct.ingredientsRaw, LIMITS.ingredientsRaw),
    storage: text(rawProduct.storage, LIMITS.storage),
    shelfLifeText: text(rawProduct.shelfLifeText, LIMITS.shelfLifeText),
    shelfLifeMonths: Number.isFinite(Number(rawProduct.shelfLifeMonths))
      ? Number(rawProduct.shelfLifeMonths)
      : undefined,
    packageGrams: Number.isFinite(Number(rawProduct.packageGrams))
      ? Number(rawProduct.packageGrams)
      : undefined,
    nutrition: normalizeNutrition(rawProduct.nutrition),
    productionDate: validDate(rawProduct.productionDate) ? rawProduct.productionDate : undefined,
    expiryDate: validDate(rawProduct.expiryDate) ? rawProduct.expiryDate : undefined,
    expiryHumanConfirmed: Boolean(rawProduct.expiryHumanConfirmed),
  };
}

function adminPage(query, products) {
  const rows = products
    .map(
      (product) => `<tr>
        <td><code>${escapeHtml(product.barcode)}</code></td>
        <td>${escapeHtml(product.name)}<br><small>${escapeHtml(product.brand)}</small></td>
        <td>
          品牌商：${escapeHtml(product.brandOwner || '')}<br>
          <small>厂家：${escapeHtml(product.manufacturer || '')}</small>
        </td>
        <td>${escapeHtml(product.category ?? '')}</td>
        <td>${product.verified ? '已验证' : '待验证'}${product.humanConfirmed ? ' · 人工确认' : ''}</td>
        <td>${escapeHtml(product.status)}</td>
        <td>
          <form method="post" action="/admin/product/${encodeURIComponent(product.barcode)}">
            <input type="hidden" name="action" value="${product.status === 'active' ? 'unpublish' : 'publish'}">
            <button>${product.status === 'active' ? '下架' : '恢复'}</button>
          </form>
          <details>
            <summary>编辑</summary>
            <form method="post" action="/admin/product/${encodeURIComponent(product.barcode)}" class="edit">
              <input type="hidden" name="action" value="edit">
              <label>名称<input name="name" value="${escapeHtml(product.name)}"></label>
              <label>品牌<input name="brand" value="${escapeHtml(product.brand)}"></label>
              <label>品牌商<input name="brandOwner" value="${escapeHtml(product.brandOwner || '')}"></label>
              <label>生产厂家<input name="manufacturer" value="${escapeHtml(product.manufacturer || '')}"></label>
              <label>分类<input name="category" value="${escapeHtml(product.category ?? '')}"></label>
              <label>用途<input name="kind" value="${escapeHtml(product.kind ?? '')}"></label>
              <label>保质期月数<input name="shelfLifeMonths" type="number" value="${escapeHtml(product.shelfLifeMonths ?? '')}"></label>
              <label>配料<textarea name="ingredientsRaw">${escapeHtml(product.ingredientsRaw)}</textarea></label>
              <button>保存并人工确认</button>
            </form>
          </details>
        </td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>效期管家 · 商品库管理</title>
<style>
body{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;margin:24px;background:#fbf8f2;color:#1c1a16}
input,textarea,button{font:inherit} input,textarea{width:100%;padding:6px;border:1px solid #d9d1c1;border-radius:6px}
form{display:inline} table{border-collapse:collapse;width:100%;background:#fffdf8}th,td{padding:9px;border:1px solid #e8e2d6;vertical-align:top;text-align:left}
tr:nth-child(even){background:#f8f4eb}.edit{display:grid;gap:6px;min-width:260px;margin-top:8px}.search{display:flex;gap:8px;margin:16px 0}.search input{max-width:360px}
button{padding:6px 10px;border:1px solid #d9d1c1;border-radius:6px;background:#fffdf8;cursor:pointer}small{color:#736e64}
</style></head><body>
<h1>商品库管理</h1>
<form class="search" method="get"><input name="q" value="${escapeHtml(query)}" placeholder="搜索条码、名称、品牌或厂家"><button>搜索</button></form>
<table><thead><tr><th>条码</th><th>商品</th><th>品牌商 / 厂家</th><th>分类</th><th>状态</th><th>发布</th><th>管理</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">没有结果</td></tr>'}</tbody></table>
</body></html>`;
}

export function createApp({
  db,
  hmacSecret = process.env.HMAC_SECRET,
  adminPassword = process.env.ADMIN_PASSWORD,
  rateLimitMax = 60,
  now = Date.now,
  releaseDir = defaultReleaseDir,
  barcodeLookup,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Timestamp,X-Nonce,X-Signature');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(
    express.json({
      limit: '24kb',
      verify: (req, _res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(
    '/release',
    express.static(releaseDir, {
      fallthrough: true,
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          filePath.endsWith('version.json') ? 'no-store' : 'public, max-age=300',
        );
      },
    }),
  );

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' },
  });
  const hmac = createHmacMiddleware({ secret: hmacSecret, now });

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, service: 'expiry-keeper-product-library', ...productCounts(db) });
  });

  app.use('/api/v1', limiter);
  app.use('/api/v1/product', hmac);
  app.use('/api/v1/contribute', hmac);

  app.get('/api/v1/product/:barcode', async (req, res) => {
    const barcode = normalizeBarcode(req.params.barcode);
    if (!barcode) return res.status(400).json({ error: '条码长度应为 8-14 位数字' });
    let product = getProduct(db, barcode);
    if (!product && barcodeLookup) {
      try {
        const external = await barcodeLookup(barcode);
        if (external) product = cacheExternalProduct(db, external);
      } catch (error) {
        // 外部条码服务失败时保持未命中，让 App 继续走 AI 或手工录入。
        console.warn('[barcode] lookup unavailable:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    if (!product) return res.status(404).json({ found: false, error: '商品库暂无记录' });
    res.json({ found: true, product });
  });

  app.post('/api/v1/contribute', (req, res) => {
    const problem = validateContributionBody(req.body);
    if (problem) return res.status(400).json({ error: problem });
    const barcode = normalizeBarcode(req.body.barcode);
    const userHash = String(req.body.user_hash).toLowerCase();
    if (!validUserHash(userHash)) return res.status(400).json({ error: 'user_hash 不合法' });
    const id = enqueueContribution(db, {
      barcode,
      userHash,
      raw: { barcode, product: sanitizedContribution(req.body.product) },
    });
    res.status(202).json({ ok: true, id, status: 'pending' });
  });

  const adminAuth = (req, res, next) => {
    if (!adminPassword) return res.status(503).send('服务端未配置 ADMIN_PASSWORD');
    if (basicAuthPassword(req.get('authorization')) === adminPassword) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="expiry-keeper-admin"');
    return res.status(401).send('需要管理密码');
  };
  app.get('/admin', adminAuth, (req, res) => {
    const query = text(req.query.q, 200);
    res.type('html').send(adminPage(query, searchProducts(db, query)));
  });
  app.post('/admin/product/:barcode', adminAuth, (req, res) => {
    const barcode = normalizeBarcode(req.params.barcode);
    if (!barcode) return res.status(400).send('条码不合法');
    const action = req.body.action;
    if (action === 'unpublish') setProductStatus(db, barcode, 'unpublished');
    else if (action === 'publish') setProductStatus(db, barcode, 'active');
    else if (action === 'edit') {
      const cleaned = sanitizeCleanedProduct(
        {
          barcode,
          name: req.body.name,
          brand: req.body.brand,
          brandOwner: req.body.brandOwner,
          manufacturer: req.body.manufacturer,
          category: req.body.category || undefined,
          kind: req.body.kind || undefined,
          ingredientsRaw: req.body.ingredientsRaw,
          shelfLifeMonths: req.body.shelfLifeMonths || undefined,
        },
        barcode,
      );
      if (cleaned) updateProductAsAdmin(db, barcode, cleaned);
    }
    res.redirect(303, `/admin?q=${encodeURIComponent(barcode)}`);
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: '请求体过大' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式错误' });
    console.error('[server]', error);
    res.status(500).json({ error: '服务内部错误' });
  });
  return app;
}
