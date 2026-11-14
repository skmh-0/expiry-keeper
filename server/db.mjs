import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const VOTE_FIELDS = [
  ['name', 'name'],
  ['brand', 'brand'],
  ['brandOwner', 'brand_owner'],
  ['manufacturer', 'manufacturer'],
  ['category', 'category'],
  ['kind', 'kind'],
  ['ingredientsRaw', 'ingredients_raw'],
  ['shelfLifeMonths', 'shelf_life_months'],
  ['packageGrams', 'package_grams'],
  ['nutrition', 'nutrition_json'],
];

const CORE_VERIFY_FIELDS = ['name', 'brand', 'manufacturer', 'ingredientsRaw'];

function stableJson(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableJson(item))));
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce((output, key) => {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '') output[key] = value[key];
        return output;
      }, {}),
  );
}

function valueHash(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function openDatabase(filename = 'server/data/product-library.sqlite') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      barcode TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      brand_owner TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT '',
      category TEXT,
      kind TEXT,
      ingredients_raw TEXT NOT NULL DEFAULT '',
      shelf_life_months INTEGER,
      package_grams REAL,
      nutrition_json TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      verified_fields TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      human_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      cleaned_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_contributions_status
      ON contributions(status, id);

    CREATE TABLE IF NOT EXISTS field_votes (
      barcode TEXT NOT NULL,
      field TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      value_json TEXT NOT NULL,
      value_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (barcode, field, user_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_field_votes_count
      ON field_votes(barcode, field, value_hash);

    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const productColumns = new Set(db.pragma('table_info(products)').map((column) => column.name));
  if (!productColumns.has('brand_owner')) {
    db.exec("ALTER TABLE products ADD COLUMN brand_owner TEXT NOT NULL DEFAULT ''");
  }
  return db;
}

export function enqueueContribution(db, { barcode, userHash, raw }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO contributions (barcode, user_hash, raw_json, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .run(barcode, userHash, JSON.stringify(raw), now);
  return Number(info.lastInsertRowid);
}

export function mapProduct(row) {
  if (!row) return undefined;
  let nutrition;
  try {
    nutrition = row.nutrition_json ? JSON.parse(row.nutrition_json) : undefined;
  } catch {
    nutrition = undefined;
  }
  let verifiedFields = [];
  try {
    verifiedFields = JSON.parse(row.verified_fields || '[]');
  } catch {
    verifiedFields = [];
  }
  return {
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    brandOwner: row.brand_owner,
    manufacturer: row.manufacturer,
    category: row.category ?? undefined,
    kind: row.kind ?? undefined,
    ingredientsRaw: row.ingredients_raw,
    shelfLifeMonths: row.shelf_life_months ?? undefined,
    packageGrams: row.package_grams ?? undefined,
    nutrition,
    verified: Boolean(row.verified),
    verifiedFields,
    humanConfirmed: Boolean(row.human_confirmed),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function getProduct(db, barcode) {
  return mapProduct(db.prepare('SELECT * FROM products WHERE barcode = ? AND status = ?').get(barcode, 'active'));
}

export function cacheExternalProduct(db, product) {
  const now = Date.now();
  upsertBaseProduct(db, product.barcode, product, now);
  return getProduct(db, product.barcode);
}

function outputValue(cleaned, apiField, dbField) {
  if (apiField === 'nutrition') return cleaned.nutrition ? JSON.stringify(cleaned.nutrition) : null;
  const value = cleaned[apiField];
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function upsertBaseProduct(db, barcode, cleaned, now) {
  const existing = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
  const columns = VOTE_FIELDS.map((field) => field[1]);
  const values = VOTE_FIELDS.map(([apiField]) => outputValue(cleaned, apiField));
  const named = Object.fromEntries(columns.map((column, index) => [column, values[index]]));

  if (!existing) {
    db.prepare(
      `INSERT INTO products (
        barcode, name, brand, brand_owner, manufacturer, category, kind, ingredients_raw,
        shelf_life_months, package_grams, nutrition_json, status, created_at, updated_at
      ) VALUES (
        @barcode, @name, @brand, @brand_owner, @manufacturer, @category, @kind, @ingredients_raw,
        @shelf_life_months, @package_grams, @nutrition_json, 'active', @created_at, @updated_at
      )`,
    ).run({
      barcode,
      name: named.name ?? '',
      brand: named.brand ?? '',
      brand_owner: named.brand_owner ?? '',
      manufacturer: named.manufacturer ?? '',
      category: named.category,
      kind: named.kind,
      ingredients_raw: named.ingredients_raw ?? '',
      shelf_life_months: named.shelf_life_months,
      package_grams: named.package_grams,
      nutrition_json: named.nutrition_json,
      created_at: now,
      updated_at: now,
    });
    return;
  }

  // 新贡献只补空字段，不能直接用单条数据覆盖人工或投票确认过的字段。
  const verifiedFields = new Set(JSON.parse(existing.verified_fields || '[]'));
  const patch = {};
  for (const [apiField, column] of VOTE_FIELDS) {
    if (verifiedFields.has(apiField) || existing.human_confirmed) continue;
    const current = existing[column];
    if ((current === null || current === undefined || current === '') && named[column] !== null) {
      patch[column] = named[column];
    }
  }
  if (Object.keys(patch).length) {
    const assignments = Object.keys(patch).map((column) => `${column} = @${column}`).join(', ');
    db.prepare(`UPDATE products SET ${assignments}, updated_at = @updated_at WHERE barcode = @barcode`).run({
      ...patch,
      barcode,
      updated_at: now,
    });
  }
}

function applyFieldVotes(db, barcode, userHash, cleaned, now) {
  const product = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
  if (!product || product.human_confirmed) return;
  const verifiedFields = new Set(JSON.parse(product.verified_fields || '[]'));

  for (const [apiField, column] of VOTE_FIELDS) {
    const value = outputValue(cleaned, apiField);
    if (value === null) continue;
    const hash = valueHash(value);
    db.prepare(
      `INSERT INTO field_votes (barcode, field, user_hash, value_json, value_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(barcode, field, user_hash)
       DO UPDATE SET value_json = excluded.value_json, value_hash = excluded.value_hash, created_at = excluded.created_at`,
    ).run(barcode, apiField, userHash, value, hash, now);
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM field_votes WHERE barcode = ? AND field = ? AND value_hash = ?')
      .get(barcode, apiField, hash).count;
    if (count >= 3) {
      db.prepare(`UPDATE products SET ${column} = ?, updated_at = ? WHERE barcode = ?`).run(value, now, barcode);
      verifiedFields.add(apiField);
    }
  }

  const current = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
  const coreVerified = CORE_VERIFY_FIELDS.every(
    (field) => verifiedFields.has(field) && String(current[VOTE_FIELDS.find(([api]) => api === field)[1]] ?? '').trim(),
  );
  db.prepare('UPDATE products SET verified = ?, verified_fields = ?, updated_at = ? WHERE barcode = ?').run(
    coreVerified ? 1 : 0,
    JSON.stringify([...verifiedFields]),
    now,
    barcode,
  );
}

export async function processPendingContributions(db, cleaner, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const limit = options.limit ?? 10;
  db.prepare("UPDATE contributions SET status = 'pending' WHERE status = 'processing'").run();
  const rows = db
    .prepare("SELECT * FROM contributions WHERE status = 'pending' ORDER BY id LIMIT ?")
    .all(limit);
  const result = { processed: 0, discarded: 0, pending: 0 };

  for (const row of rows) {
    db.prepare("UPDATE contributions SET status = 'processing' WHERE id = ?").run(row.id);
    try {
      const raw = JSON.parse(row.raw_json);
      const cleaned = await cleaner({ barcode: row.barcode, raw, contributionId: row.id });
      if (!cleaned || !cleaned.name) {
        db.prepare(
          `UPDATE contributions SET status = 'discarded', error = ?, processed_at = ? WHERE id = ?`,
        ).run('清洗后缺少最低限度字段', Date.now(), row.id);
        result.discarded += 1;
        continue;
      }
      const now = Date.now();
      const transaction = db.transaction(() => {
        upsertBaseProduct(db, row.barcode, cleaned, now);
        applyFieldVotes(db, row.barcode, row.user_hash, cleaned, now);
        db.prepare(
          `UPDATE contributions SET status = 'processed', cleaned_json = ?, error = NULL, processed_at = ? WHERE id = ?`,
        ).run(JSON.stringify(cleaned), now, row.id);
      });
      transaction();
      result.processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('未配置 DEEPSEEK_API_KEY')) {
        db.prepare("UPDATE contributions SET status = 'pending', error = ? WHERE id = ?").run(
          message.slice(0, 500),
          row.id,
        );
        result.pending += 1;
        continue;
      }
      const attempts = row.attempts + 1;
      const status = attempts >= maxAttempts ? 'discarded' : 'pending';
      db.prepare('UPDATE contributions SET status = ?, attempts = ?, error = ? WHERE id = ?').run(
        status,
        attempts,
        message.slice(0, 500),
        row.id,
      );
      if (status === 'discarded') result.discarded += 1;
      else result.pending += 1;
    }
  }
  return result;
}

export function startContributionWorker(db, cleaner, options = {}) {
  const intervalMs = options.intervalMs ?? 15_000;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await processPendingContributions(db, cleaner, options);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}

export function updateProductAsAdmin(db, barcode, patch) {
  const fields = {
    name: 'name',
    brand: 'brand',
    brandOwner: 'brand_owner',
    manufacturer: 'manufacturer',
    category: 'category',
    kind: 'kind',
    ingredientsRaw: 'ingredients_raw',
    shelfLifeMonths: 'shelf_life_months',
    packageGrams: 'package_grams',
  };
  const assignments = [];
  const values = { barcode, now: Date.now() };
  for (const [apiField, column] of Object.entries(fields)) {
    if (patch[apiField] !== undefined) {
      assignments.push(`${column} = @${apiField}`);
      values[apiField] = patch[apiField];
    }
  }
  if (!assignments.length) return;
  db.prepare(
    `UPDATE products SET ${assignments.join(', ')}, human_confirmed = 1, verified = 1, updated_at = @now WHERE barcode = @barcode`,
  ).run(values);
  db.prepare('INSERT INTO admin_audit (barcode, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    barcode,
    'edit',
    JSON.stringify(Object.keys(patch)),
    Date.now(),
  );
}

export function setProductStatus(db, barcode, status) {
  db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE barcode = ?').run(status, Date.now(), barcode);
  db.prepare('INSERT INTO admin_audit (barcode, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    barcode,
    status,
    null,
    Date.now(),
  );
}

export function searchProducts(db, query = '', limit = 50) {
  const needle = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM products
       WHERE ? = '' OR barcode LIKE ? OR name LIKE ? OR brand LIKE ? OR brand_owner LIKE ? OR manufacturer LIKE ?
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(query, needle, needle, needle, needle, needle, limit)
    .map(mapProduct);
}

export function productCounts(db) {
  return {
    products: db.prepare('SELECT COUNT(*) AS count FROM products').get().count,
    active: db.prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'active'").get().count,
    pendingContributions: db
      .prepare("SELECT COUNT(*) AS count FROM contributions WHERE status = 'pending'")
      .get().count,
  };
}

export { CORE_VERIFY_FIELDS, VOTE_FIELDS, stableJson, valueHash };
