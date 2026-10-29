/**
 * 默认更新源：本机 release 目录（npm run release:serve 起在 5276）。
 * 注意这是电脑的局域网 IP，路由器重新分配地址后需要在
 * 「设置 → 应用更新 → 更新源」里改，或者给电脑设固定 IP。
 */
/**
 * 不写死电脑的局域网地址：地址会被路由器换掉。
 * 留空时由 useUpdater 扫描同网段寻找 5276 端口上的更新服务。
 */
export const DEFAULT_UPDATE_SOURCE = '';

/** 识别引擎固定走 DeepSeek：用户只需要填 API Key。 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';

/**
 * 商品查询库 HMAC 密钥。构建时通过 VITE_PRODUCT_API_HMAC_SECRET 注入，
 * 且必须与服务端 HMAC_SECRET 一致。公开构建不内置通用密钥。
 */
export const PRODUCT_API_HMAC_SECRET = import.meta.env.VITE_PRODUCT_API_HMAC_SECRET || '';
export const PRODUCT_API_TIMEOUT_MS = 2_000;
export const PRODUCT_USER_HASH_SALT = 'expiry-keeper-product-user-v1';
