import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeLookup } from '../barcode.mjs';

test('极速数据条码结果转换为商品并缓存命中', async () => {
  let calls = 0;
  let captured;
  const lookup = createBarcodeLookup({
    appCode: 'test-appcode',
    now: () => 1000,
    fetchImpl: async (url, init) => {
      calls += 1;
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          status: 0,
          msg: 'ok',
          result: {
            barcode: '6917878036526',
            name: '雀巢白咖啡',
            brand: '雀巢咖啡',
            company: '雀巢(中国)有限公司',
            netweight: '145克',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  const product = await lookup('06917878036526');
  assert.equal(product.barcode, '06917878036526');
  assert.equal(product.name, '雀巢白咖啡');
  assert.equal(product.brand, '雀巢咖啡');
  assert.equal(product.brandOwner, '雀巢(中国)有限公司');
  assert.equal(product.manufacturer, '');
  assert.equal(product.packageGrams, 145);
  assert.equal(captured.init.headers.Authorization, 'APPCODE test-appcode');
  assert.match(captured.url, /barcode=06917878036526/);

  await lookup('06917878036526');
  assert.equal(calls, 1);
});

test('条码接口未收录时不生成商品', async () => {
  const lookup = createBarcodeLookup({
    appCode: 'test-appcode',
    fetchImpl: async () =>
      new Response(JSON.stringify({ status: 210, msg: '没有信息', result: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  assert.equal(await lookup('6901234567892'), undefined);
});
