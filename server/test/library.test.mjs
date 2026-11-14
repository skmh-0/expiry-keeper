import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.mjs';
import {
  enqueueContribution,
  getProduct,
  openDatabase,
  processPendingContributions,
  searchProducts,
} from '../db.mjs';
import { requestSignature } from '../security.mjs';

const SECRET = 'test-hmac-secret';
const ADMIN = 'test-admin-password';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function signedHeaders(method, path, body = '') {
  const timestamp = String(Date.now());
  const nonce = hash(`${path}:${Math.random()}`).slice(0, 24);
  return {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': requestSignature(SECRET, {
      method,
      path,
      timestamp,
      nonce,
      body,
    }),
  };
}

function cleanProduct(barcode, name = '测试猫粮') {
  return {
    barcode,
    name,
    brand: '测试品牌',
    brandOwner: '测试品牌管理有限公司',
    manufacturer: '测试宠物食品有限公司',
    category: 'dry',
    kind: 'staple',
    ingredientsRaw: '鸡肉、糙米',
    storage: '阴凉干燥处',
    shelfLifeText: '18个月',
    shelfLifeMonths: 18,
    packageGrams: 1500,
    nutrition: { metabolizableEnergy: '4000 kcal/kg' },
  };
}

test('health 公开，商品查询必须 HMAC 签名', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ db, hmacSecret: SECRET, adminPassword: ADMIN });
  await request(app).get('/api/v1/health').expect(200).expect((res) => {
    assert.equal(res.body.ok, true);
  });
  await request(app).get('/api/v1/product/6901234567892').expect(401);
  db.close();
});

test('本地未命中时调用外部条码源并缓存结果', async () => {
  const db = openDatabase(':memory:');
  const barcode = '6901234567892';
  let calls = 0;
  const app = createApp({
    db,
    hmacSecret: SECRET,
    adminPassword: ADMIN,
    barcodeLookup: async (value) => {
      calls += 1;
      return cleanProduct(value, '外部条码猫粮');
    },
  });
  const path = `/api/v1/product/${barcode}`;
  await request(app)
    .get(path)
    .set(signedHeaders('GET', path))
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.product.name, '外部条码猫粮');
      assert.equal(res.body.product.verified, false);
    });
  assert.equal(calls, 1);
  assert.equal(getProduct(db, barcode).name, '外部条码猫粮');

  await request(app)
    .get(path)
    .set(signedHeaders('GET', path))
    .expect(200);
  assert.equal(calls, 1);
  db.close();
});

test('contribute 校验字段长度并使用纯文本入库', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ db, hmacSecret: SECRET, adminPassword: ADMIN });
  const body = {
    barcode: '6901234567892',
    user_hash: hash('device-a'),
    product: { ...cleanProduct('6901234567892'), photo: 'data:image/jpeg;base64,AAAA' },
  };
  const serialized = JSON.stringify(body);
  await request(app)
    .post('/api/v1/contribute')
    .set(signedHeaders('POST', '/api/v1/contribute', serialized))
    .send(serialized)
    .expect(202);
  const row = db.prepare('SELECT * FROM contributions').get();
  assert.equal(row.status, 'pending');
  assert.equal(JSON.parse(row.raw_json).product.photo, undefined);

  const dirty = {
    barcode: '6901234567892',
    user_hash: hash('device-b'),
    product: { ...cleanProduct('6901234567892'), name: 'x'.repeat(201) },
  };
  const dirtyBody = JSON.stringify(dirty);
  await request(app)
    .post('/api/v1/contribute')
    .set(signedHeaders('POST', '/api/v1/contribute', dirtyBody))
    .send(dirtyBody)
    .expect(400);
  db.close();
});

test('10 条脏贡献清洗后 8 条入库、2 条安全丢弃', async () => {
  const db = openDatabase(':memory:');
  for (let index = 0; index < 10; index += 1) {
    enqueueContribution(db, {
      barcode: `69012345678${String(index).padStart(2, '0')}`,
      userHash: hash(`device-${index}`),
      raw: { product: { name: index % 3 === 0 ? '  ' : ` 脏名字 ${index} ` } },
    });
  }
  let calls = 0;
  const result = await processPendingContributions(db, async ({ barcode, raw }) => {
    calls += 1;
    const index = Number(barcode.slice(-2));
    if (index >= 8) return undefined;
    return cleanProduct(barcode, String(raw.product.name).trim() || '清洗后的测试猫粮');
  });
  assert.equal(calls, 10);
  assert.deepEqual(result, { processed: 8, discarded: 2, pending: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contributions WHERE status = 'processed'").get().count, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contributions WHERE status = 'discarded'").get().count, 2);
  db.close();
});

test('同字段三个不同 user_hash 一致后商品 verified=1', async () => {
  const db = openDatabase(':memory:');
  const barcode = '6901234567892';
  for (let index = 0; index < 3; index += 1) {
    enqueueContribution(db, {
      barcode,
      userHash: hash(`voter-${index}`),
      raw: { product: cleanProduct(barcode) },
    });
  }
  const result = await processPendingContributions(db, async () => cleanProduct(barcode));
  assert.equal(result.processed, 3);
  const product = getProduct(db, barcode);
  assert.equal(product.verified, true);
  assert.ok(product.verifiedFields.includes('name'));
  assert.ok(product.verifiedFields.includes('manufacturer'));
  assert.equal(product.brandOwner, '测试品牌管理有限公司');
  const app = createApp({ db, hmacSecret: SECRET, adminPassword: ADMIN });
  const path = `/api/v1/product/${barcode}`;
  await request(app)
    .get(path)
    .set(signedHeaders('GET', path))
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.found, true);
      assert.equal(res.body.product.name, '测试猫粮');
      assert.equal(res.body.product.verified, true);
    });
  db.close();
});

test('password 管理页支持搜索与下架', async () => {
  const db = openDatabase(':memory:');
  enqueueContribution(db, {
    barcode: '6901234567892',
    userHash: hash('admin-seed'),
    raw: { product: cleanProduct('6901234567892') },
  });
  await processPendingContributions(db, async () => cleanProduct('6901234567892'));
  const app = createApp({ db, hmacSecret: SECRET, adminPassword: ADMIN });
  await request(app).get('/admin').expect(401);
  const auth = `Basic ${Buffer.from(`admin:${ADMIN}`).toString('base64')}`;
  await request(app)
    .get('/admin?q=6901234567892')
    .set('Authorization', auth)
    .expect(200)
    .expect((res) => assert.match(res.text, /测试猫粮/));
  assert.equal(searchProducts(db, '6901234567892')[0].status, 'active');
  await request(app)
    .post('/admin/product/6901234567892')
    .set('Authorization', auth)
    .type('form')
    .send({ action: 'unpublish' })
    .expect(303);
  assert.equal(searchProducts(db, '6901234567892')[0].status, 'unpublished');
  await request(app)
    .post('/admin/product/6901234567892')
    .set('Authorization', auth)
    .type('form')
    .send({
      action: 'edit',
      name: '人工确认猫粮',
      brand: '人工品牌',
      brandOwner: '人工品牌管理有限公司',
      manufacturer: '人工确认工厂',
      category: 'dry',
      kind: 'staple',
      ingredientsRaw: '鸡肉',
      shelfLifeMonths: '18',
    })
    .expect(303);
  const edited = searchProducts(db, '6901234567892')[0];
  assert.equal(edited.name, '人工确认猫粮');
  assert.equal(edited.brandOwner, '人工品牌管理有限公司');
  assert.equal(edited.manufacturer, '人工确认工厂');
  assert.equal(edited.humanConfirmed, true);
  db.close();
});

test('商品 API 每分钟限额生效', async () => {
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    hmacSecret: SECRET,
    adminPassword: ADMIN,
    rateLimitMax: 2,
  });
  for (let index = 0; index < 2; index += 1) {
    const path = '/api/v1/product/6901234567892';
    await request(app)
      .get(path)
      .set(signedHeaders('GET', path))
      .expect(404);
  }
  const path = '/api/v1/product/6901234567892';
  await request(app)
    .get(path)
    .set(signedHeaders('GET', path))
    .expect(429);
  db.close();
});
