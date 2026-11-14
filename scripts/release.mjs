/**
 * 打包一个热更新版本：
 *   1. 更新 package.json 与 src/version.ts 的版本号
 *   2. 构建 Web 资源
 *   3. 把 dist 打成 zip（自带 zip 写出实现，不依赖第三方包）
 *   4. 生成 release/version.json（版本、下载地址、SHA-256、说明）
 *
 * 用法：node scripts/release.mjs 0.2.0 "更新说明"
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const notes = process.argv[3] ?? '';

if (!version || !/^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法：node scripts/release.mjs <版本号 如 0.2.0> ["更新说明"]');
  process.exit(1);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function zipEntries(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuffer, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x0021, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralBuffer, end]);
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

// 1. 版本号
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
writeFileSync(
  join(root, 'src', 'version.ts'),
  `/** 由 scripts/release.mjs 自动改写，请勿手工调整格式。 */\nexport const APP_VERSION = import.meta.env.VITE_APP_VERSION || '${version}';\n`,
  'utf8',
);
console.log(`版本号 → ${version}`);

// 2. 构建
const build = spawnSync(
  process.execPath,
  ['--require', './scripts/patch-net-use.cjs', './node_modules/vite/bin/vite.js', 'build'],
  { cwd: root, stdio: 'inherit' },
);
if (build.status !== 0) {
  console.error('构建失败，已终止发布');
  process.exit(build.status ?? 1);
}

// 3. 打 zip
const distDir = join(root, 'dist');
const entries = walk(distDir).map((file) => ({
  name: relative(distDir, file).split(sep).join('/'),
  data: readFileSync(file),
}));
const zip = zipEntries(entries);

const releaseDir = join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
const zipName = `bundle-${version}.zip`;
writeFileSync(join(releaseDir, zipName), zip);

// 4. 清单
const sha256 = createHash('sha256').update(zip).digest('hex');
const manifest = {
  version,
  url: zipName,
  sha256,
  size: zip.length,
  notes,
  builtAt: new Date().toISOString(),
  files: entries.length,
};
writeFileSync(join(releaseDir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`已发布 ${version}`);
console.log(`  包体  release/${zipName}  ${(zip.length / 1024).toFixed(1)} KB / ${entries.length} 个文件`);
console.log(`  指纹  sha256:${sha256}`);
console.log('  启动更新源：npm run release:serve');
