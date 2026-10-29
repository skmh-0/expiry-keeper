/** 在局域网里托管 release 目录，供手机端检查并下载热更新。 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'release');
const port = Number(process.env.PORT ?? 5276);

const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(root)) {
  console.error('release 目录不存在，先运行 npm run release');
  process.exit(1);
}

createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const target = join(root, normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(root) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }
  const type = TYPES[extname(target)] ?? 'application/octet-stream';
  const size = statSync(target).size;
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    // 手机端在 WebView 里直接探测这个地址，需要放开跨域
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': pathname.endsWith('.json') ? 'no-store' : 'public, max-age=300',
  });
  createReadStream(target).pipe(response);
}).listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  console.log(`更新源已启动，端口 ${port}`);
  addresses.forEach((address) => console.log(`  http://${address}:${port}/version.json`));
});
