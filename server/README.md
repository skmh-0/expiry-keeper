# 效期管家商品查询库

## 启动

```powershell
$env:HMAC_SECRET='替换成随机长密钥'
$env:ADMIN_PASSWORD='替换成管理密码'
$env:DEEPSEEK_API_KEY='服务端 DeepSeek Key'
$env:BARCODE_APPCODE='可选，极速数据条码查询 AppCode'
npm run server
```

默认监听 `5280`，数据库为 `server/data/product-library.sqlite`。
App 的「设置 → 商品查询库」填写服务地址和与服务端一致的 HMAC 密钥。
HMAC 密钥通过 Android Keystore 保存，不进入 APK、快照或导出备份。

## API

- `GET /api/v1/health`
- `GET /api/v1/product/:barcode`
- `POST /api/v1/contribute`
- `GET /admin`，HTTP Basic 密码为 `ADMIN_PASSWORD`

除健康检查外，API 需要 `X-Timestamp`、`X-Nonce`、`X-Signature`。
签名原文为 `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(BODY)`，使用 HMAC-SHA256。

## 贡献清洗

贡献先写入 SQLite 队列，由后台 worker 调用 DeepSeek 严格清洗。
模型不得猜测空字段；脏记录清洗失败重试三次后安全丢弃。
同一商品同一字段收到三个不同 `user_hash` 的一致值后标记字段已验证；
核心字段全部验证后商品 `verified=1`。

仓库不内置通用 HMAC 或管理员默认密码。未配置 `HMAC_SECRET` 时商品 API 返回
503；未配置 `ADMIN_PASSWORD` 时管理页返回 503。正式部署必须使用随机长密钥。
