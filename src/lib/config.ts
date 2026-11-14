/** 更新源由构建环境注入；开源构建留空，由用户在设置页填写。 */
export const DEFAULT_UPDATE_SOURCE = (import.meta.env.VITE_UPDATE_SOURCE || '').trim();

/** 商品查询库地址由构建环境注入；开源构建留空，由用户在设置页填写。 */
export const DEFAULT_PRODUCT_API_URL = (import.meta.env.VITE_PRODUCT_API_URL || '').trim();

/** 识别引擎固定走 DeepSeek：用户只需要填 API Key。 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_VISION_MODEL = 'deepseek-flash';

export const PRODUCT_API_TIMEOUT_MS = 2_000;
export const PRODUCT_USER_HASH_SALT = 'expiry-keeper-product-user-v1';
