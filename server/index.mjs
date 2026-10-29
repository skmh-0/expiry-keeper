import { openDatabase, startContributionWorker } from './db.mjs';
import { createDeepSeekCleaner } from './cleaner.mjs';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 5280);
const host = process.env.HOST || '0.0.0.0';
const databaseFile = process.env.DATABASE_PATH || 'server/data/product-library.sqlite';
const db = openDatabase(databaseFile);
const cleaner = createDeepSeekCleaner({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.DEEPSEEK_BASE_URL,
  model: process.env.DEEPSEEK_MODEL,
});
const stopWorker = startContributionWorker(db, cleaner, {
  intervalMs: Number(process.env.WORKER_INTERVAL_MS || 15_000),
  limit: Number(process.env.WORKER_BATCH_SIZE || 10),
  maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS || 3),
});

const app = createApp({
  db,
  hmacSecret: process.env.HMAC_SECRET,
  adminPassword: process.env.ADMIN_PASSWORD,
});
const server = app.listen(port, host, () => {
  console.log(`[product-library] http://${host}:${port}`);
  console.log(`[product-library] database ${databaseFile}`);
});

function shutdown() {
  stopWorker();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
