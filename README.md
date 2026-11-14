# 效期管家 2.1

为养猫家庭设计的商品效期与库存管理 App。扫描条码、拍摄包装背标或手工录入商品，管理开封、用完、库存分类、宠物档案与消耗记录。

## 功能

- Android App，本地离线保存商品、库存、宠物与消耗数据
- 条码扫描、相册选图、多张包装照片与喷码补拍
- 用户自行配置 DeepSeek API Key、商品查询库地址与 HMAC 密钥，不内置开发者密钥
- 按单件克数记录库存，支持主食/零食、干粮/湿粮分类
- 开封、用完、消耗区间统计、疫苗与驱虫提醒
- 可选商品查询库，查询失败时自动降级到 AI 或手工录入
- 数据导出/导入，API Key 与商品查询库 HMAC 密钥不进入导出文件和普通持久化数据

## 隐私

- 商品、库存、宠物、操作记录与照片默认只保存在手机本地。
- 启用 AI 识别时，照片会由手机直接发送到用户自己配置的 DeepSeek API。
- 本项目提供的商品库服务只接收文本字段，不接收照片、宠物资料或 DeepSeek API Key。
- 商品贡献数据使用加盐设备哈希，不包含可直接反推设备身份的明文标识。
- 用户自行填写的 DeepSeek API Key 与商品查询库 HMAC 密钥不写入数据备份，也不进入商品贡献请求。

## 本地运行

```powershell
npm install
npm run dev
npm run build
npm run test:server
```

浏览器开发地址默认为 `http://localhost:5273`。

## Android 打包

```powershell
npm run android:sync
npm run android:apk
```

APK 输出到 `android/app/build/outputs/apk/release/app-release.apk`。

覆盖安装必须使用同一包名和签名证书。包名固定为 `com.skmh.expirykeeper`；升级时不要卸载旧版，以免清空本地数据。

开源独立构建：

```powershell
npm run android:sync
npm run android:apk:open
```

开源版包名为 `com.skmh.expirykeeper.opensource`，应用名为“效期管家开源版”，
可与私有版同时安装。开源构建不包含服务器 IP、默认 HTTP 地址或 HMAC 密钥。

## 商品查询库

后端代码位于 `server/`，详细说明见 `server/README.md`。

```powershell
$env:HMAC_SECRET='替换为随机长密钥'
$env:ADMIN_PASSWORD='替换为管理密码'
$env:DEEPSEEK_API_KEY='服务端清洗用 Key'
$env:BARCODE_APPCODE='可选，极速数据条码查询 AppCode'
npm run server
```

在 App 的「设置 → 商品查询库」填写服务地址和与服务端一致的 HMAC 密钥。
HMAC 密钥通过 Android Keystore 保存，不进入 APK、数据快照或导出备份。

更新源同样在「设置 → 应用更新」中配置，开源构建不内置服务器地址。

## 数据兼容

当前数据 schema 为 7。升级不会主动清空用户录入的商品、库存、宠物或照片。应用启动时会继续兼容旧版备份并补齐缺失的默认字段。

## 开源与反馈

- 仓库：https://github.com/skmh-0/expiry-keeper
- 问题反馈：https://github.com/skmh-0/expiry-keeper/issues/new

## 许可证

MIT，详见 [LICENSE](LICENSE)。
