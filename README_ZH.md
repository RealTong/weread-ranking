# weread-ranking

[English README](./README.md)

`weread-ranking` 是一个部署在 Cloudflare Workers 上的微信读书同步服务，用来把微信读书数据同步到 D1，并通过稳定的本地缓存 API 对外提供。

它围绕一个比较实用的工作流设计：

- 微信读书凭证更新快，不适合长期写死在环境变量里。
- 可以通过 Android 自动化定时打开代理工具和微信读书，自动刷新凭证。
- Worker 只负责保存最新凭证、执行同步，并对外提供本地缓存数据。

## 功能

- 在 D1 中保存唯一的一份当前微信读书凭证
- 同步好友阅读总时长快照
- 同步好友周榜快照
- 同步你的 `/mine/readbook` 历史书单到 D1
- 提供好友、周榜、书单等缓存 HTTP API
- 同时支持手动上传凭证和 Android 自动抓取凭证

## 整体数据流

1. Android 自动化先打开代理 App，再打开微信读书。
2. 仓库内置的重写脚本会捕获微信读书 `/login` 响应和部分请求头。
3. 重写脚本把这些数据转发到 `POST /api/admin/weread/credentials`。
4. Worker 把最新凭证保存到 D1。
5. 定时 cron 或 `POST /api/admin/refresh` 从 D1 取出当前凭证并同步微信读书数据。
6. 前端或脚本只读取 `/api/aio`、`/api/readbooks` 等本地缓存 API。

## 仓库文件说明

- [`src/`](./src)：Worker 路由、服务层、D1 存储和 WeRead 集成代码
- [`migrations/`](./migrations)：D1 数据库迁移
- [`weread-rewrite.js`](./weread-rewrite.js)：把微信读书凭证转发到 Worker 的重写脚本
- [`weread-rewrite.macro`](./weread-rewrite.macro)：Android 自动化宏导出文件，用来定时打开代理 App 和微信读书
- [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro)：给亮灭屏或锁屏场景准备的 MacroDroid 备用导出文件
- [`request.http`](./request.http) 和 [`test.http`](./test.http)：本地调试请求样例

## 前置要求

- 一个 Cloudflare 账号
- 已安装 [Bun](https://bun.sh/)
- 已安装并登录 [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- 如果要自动抓凭证，需要一台 Android 设备
- 一个兼容仓库内置重写脚本的代理 App

## Worker 配置

### 1. 安装依赖

```bash
bun install
```

### 2. 创建 D1 数据库

```bash
bunx wrangler d1 create weread-ranking
```

### 3. 更新 `wrangler.jsonc`

填入你自己的 D1 `database_id`，并检查 cron 配置。

重点字段：

- `d1_databases[0].database_id`
- `triggers.crons`

当前 Worker 的默认 cron 是每小时执行一次：

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

### 4. 配置本地密钥

```bash
cp .dev.vars.example .dev.vars
```

填入：

```bash
API_KEY="replace-with-a-long-random-string"
CORS_ORIGIN="http://localhost:3000"
```

说明：

- `API_KEY` 用于保护所有管理接口和查询接口。
- `CORS_ORIGIN` 可选。
- 如果要放行多个域名，可以用逗号分隔。

### 5. 执行数据库迁移

本地开发：

```bash
bun run migrate:local
```

部署后的远程 D1：

```bash
bun run migrate:remote
```

### 6. 启动本地开发服务

```bash
bun run dev
```

默认本地地址：

```text
http://localhost:8787
```

## Android 自动抓凭证

仓库现在内置了两个 Android 侧文件：

- [`weread-rewrite.js`](./weread-rewrite.js)
- [`weread-rewrite.macro`](./weread-rewrite.macro)
- [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro)

命名说明：

- 你描述里提到的是 “Proxybin”，但仓库里的实际脚本目标是 `ProxyPin`。
- 宏文件里启动的包名是 `com.network.proxy`，脚本注释里也写的是 ProxyPin。

### `weread-rewrite.js` 的作用

这个重写脚本会：

- 监听 `weread.qq.com`
- 过滤 `/login` 请求
- 解析微信读书登录响应 JSON
- 读取这些请求头：
  - `v`
  - `basever`
  - `baseapi`
  - `channelId`
  - `appver`
  - `User-Agent`
  - `osver`
- 把整理好的 payload 异步转发到 `POST /api/admin/weread/credentials`
- 原样返回原始响应，不影响手机上的微信读书正常使用

当前仓库内置脚本的行为还有一个细节：

- 只有当 `/login` 响应里同时有 `vid` 和 `skey` 时，它才会真正发请求
- Worker 端现在允许空字符串字段，但脚本本身仍然把 `vid + skey` 作为发送条件

### 配置 `weread-rewrite.js`

在导入代理 App 之前，先改这两个占位值：

```js
var API_URL = "YOUR_API_URL/api/admin/weread/credentials";
var API_KEY = "YOUR_API_KEY";
```

建议：

- 本地调试时，`API_URL` 必须写成 Android 设备能访问到的局域网地址，比如 `http://192.168.x.x:8787`，不能写 `http://localhost:8787`
- 线上环境可以写成 `https://<your-worker-domain>/api/admin/weread/credentials`
- `API_KEY` 要和 `.dev.vars` 或 Cloudflare Secret 中配置的值保持一致

### 导入并校验 Android 宏

`weread-rewrite.macro` 是一个 Android 自动化宏导出文件，用来自动跑抓凭证流程。

根据导出的宏 JSON，一次运行会做这些事：

1. 打开 `ProxyPin`（`com.network.proxy`）
2. 等待 3 秒
3. 点击一个固定坐标，用来启动或确认代理流程
4. 再等待 5 秒
5. 以全新启动方式打开微信读书（`com.tencent.weread`）
6. 等待 30 秒，让 `/login` 请求发生并完成上报
7. 关闭微信读书
8. 关闭 ProxyPin

当前仓库里的导出文件包含这些配置：

- 一个 3600 秒的固定间隔触发器
- 导出数据里的参考起始时间是 `00:30`
- 固定点击坐标是 `x=1286`、`y=2606`

你需要在自己的设备上确认：

- 代理 App 的包名确实是 `com.network.proxy`
- 微信读书包名确实是 `com.tencent.weread`
- 固定点击坐标还能点到正确按钮
- 自动化 App 已获得无障碍、后台启动等必要权限
- 代理 App 已正确配置证书和 HTTPS 抓包能力

### 屏幕开关问题的 MacroDroid 备用脚本

有些 Android 设备在灭屏、锁屏或者亮屏恢复之后，原始自动化流程执行不稳定，导致代理 App 没有正确启动，或者 UI 操作无法按预期触发。

如果你遇到这种情况，请改用 [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro)。

这个面向 MacroDroid 的备用脚本额外做了电源状态处理：

- 执行前主动亮屏
- 打开 `ProxyPin`
- 点击固定坐标以启动或确认代理流程
- 在打开应用前后增加额外的手势操作
- 打开微信读书
- 短暂等待凭证上报完成
- 关闭两个应用
- 最后再把屏幕熄灭

当前仓库里的备用导出文件包含这些配置：

- 一个 3600 秒的固定间隔触发器
- 导出数据里的参考起始时间是 `00:34`
- 与原脚本相同的固定点击坐标 `x=1286`、`y=2606`

以下情况建议直接用这个备用脚本：

- 原始自动化在熄屏一段时间后不再触发
- 屏幕唤醒或锁屏状态导致 UI 点击不稳定
- 设备空闲时会延迟或杀掉原始自动化流程

### 推荐的自动化接入步骤

1. 把 [`weread-rewrite.js`](./weread-rewrite.js) 导入 ProxyPin 的 Rewrite / Script 功能。
2. 改好 `API_URL` 和 `API_KEY`。
3. 把 [`weread-rewrite.macro`](./weread-rewrite.macro) 导入你的 Android 自动化 App。
4. 如果你的设备有亮灭屏或锁屏导致的自动化问题，就把 [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro) 导入 MacroDroid 并改用它。
5. 根据设备分辨率调整点击坐标。
6. 手动执行一次宏。
7. 调用 `GET /api/admin/weread/credentials` 确认已经出现 `configured: true`。
8. 再让宏按定时器持续运行，保持凭证新鲜。

## 首次使用

你可以选择 Android 自动抓取，或者手动上传凭证。

### 方案 A：自动抓凭证

如果 Android 自动化已经配好：

1. 手动跑一次宏，或者等下一个定时周期。
2. 如果你的设备因为屏幕开关问题导致原宏不稳定，就切换到 [`weread-rewrite-power-optimization.macro`](./weread-rewrite-power-optimization.macro)。
3. 先确认 Worker 已经拿到凭证：

```bash
curl "http://localhost:8787/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>"
```

4. 然后触发第一次同步：

```bash
curl -X POST "http://localhost:8787/api/admin/refresh" \
  -H "x-api-key: <API_KEY>"
```

### 方案 B：手动上传凭证

也可以自己手动调用上传接口：

```bash
curl -X POST "http://localhost:8787/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "",
    "accessToken": "6aq6u4hw",
    "refreshToken": "",
    "basever": "7.5.2.10162694",
    "appver": "7.5.2.10162694",
    "v": "",
    "channelId": "1",
    "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
    "osver": "13",
    "baseapi": "33"
  }'
```

如果要强制把同步游标重置掉：

```json
{
  "vid": "449518091",
  "skey": "",
  "accessToken": "6aq6u4hw",
  "refreshToken": "",
  "basever": "7.5.2.10162694",
  "appver": "7.5.2.10162694",
  "v": "",
  "channelId": "1",
  "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
  "osver": "13",
  "baseapi": "33",
  "resetSync": true
}
```

### 触发第一次刷新

标准管理接口：

```bash
curl -X POST "http://localhost:8787/api/admin/refresh" \
  -H "x-api-key: <API_KEY>"
```

兼容旧路径的别名：

```bash
curl -X POST "http://localhost:8787/api/refresh" \
  -H "x-api-key: <API_KEY>"
```

### 查询缓存数据

```bash
curl "http://localhost:8787/api/aio" \
  -H "x-api-key: <API_KEY>"
```

## 部署

部署 Worker：

```bash
bun run deploy
```

把生产环境 `API_KEY` 写入 Cloudflare Secret：

```bash
bunx wrangler secret put API_KEY
```

然后对线上 Worker 上传凭证：

```bash
curl -X POST "https://<your-worker-domain>/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "",
    "accessToken": "6aq6u4hw",
    "refreshToken": "",
    "basever": "7.5.2.10162694",
    "appver": "7.5.2.10162694",
    "v": "",
    "channelId": "1",
    "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
    "osver": "13",
    "baseapi": "33"
  }'
```

升级说明：

- 如果是旧部署升级到当前凭证模型，必须重新上传一次凭证
- 旧的 `weread_session` 表数据不会自动迁移到 `weread_credentials`
- 只部署代码但不补传最新凭证时，刷新任务会因为缺少凭证而失败

## 凭证 Payload 约定

Worker 会把凭证字段都按字符串保存。

行为说明：

- 缺失字段会落成空字符串
- `baseapi` 可以传数字，也可以传字符串
- 存储后的 `baseapi` 会按字符串写回到 WeRead 请求头
- 上传时不会实时向 WeRead 校验凭证是否可用

示例 payload：

```json
{
  "vid": "449518091",
  "skey": "",
  "accessToken": "6aq6u4hw",
  "refreshToken": "",
  "basever": "7.5.2.10162694",
  "appver": "7.5.2.10162694",
  "v": "",
  "channelId": "1",
  "userAgent": "WeRead/7.5.2 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TP1A.221005.002.B2)",
  "osver": "13",
  "baseapi": "33"
}
```

## API 说明

所有 `/api/*` 接口都要求：

```http
x-api-key: <API_KEY>
```

所有查询接口都只返回 D1 本地缓存数据，不会把实时 WeRead 响应直接透传给调用方。

### `GET /health`

简单健康检查接口。

### `POST /api/admin/weread/credentials`

保存当前微信读书凭证。

可选字段：

- `resetSync: true` 会重置当前保存的增量游标

### `GET /api/admin/weread/credentials`

返回安全的凭证状态信息：

- 是否已配置
- 当前 `vid`
- `updatedAt`
- `updatedAtIso`

不会返回 `skey`、`accessToken`、`refreshToken` 这些敏感字段。

### `POST /api/admin/refresh`

手动执行一次同步，和 cron 共用同一条服务链路。

### `POST /api/refresh`

`POST /api/admin/refresh` 的兼容别名。

### `GET /api/aio`

返回聚合后的好友和周榜数据，适合前端一次性加载。

### `GET /api/friends`

返回缓存中的好友列表和累计阅读数据。

查询参数：

- `limit`
- `offset`

示例：

```bash
curl "http://localhost:8787/api/friends?limit=100&offset=0" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/ranking`

返回最近一次同步得到的好友周榜缓存。

### `GET /api/friends/:userVid/history`

返回某个好友的历史阅读变化。

查询参数：

- `limit`

示例：

```bash
curl "http://localhost:8787/api/friends/123456/history?limit=100" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/readbooks`

返回 D1 中缓存的个人书单数据。

查询参数：

- `limit`
- `offset`
- `markStatus`

当前项目里常用的 `markStatus`：

- `markStatus=4` 表示已读完
- `markStatus=2` 表示正在读

示例：

```bash
curl "http://localhost:8787/api/readbooks?limit=20&markStatus=4" \
  -H "x-api-key: <API_KEY>"
```

```bash
curl "http://localhost:8787/api/readbooks?limit=20&markStatus=2" \
  -H "x-api-key: <API_KEY>"
```

## 调试辅助

仓库里有两个 `.http` 调试文件：

- [`request.http`](./request.http)
- [`test.http`](./test.http)

可以直接在支持 `.http` 文件的编辑器里发送请求。

## 常用命令

```bash
bun run dev
bun run test
bun run typecheck
bun run migrate:local
bun run migrate:remote
bun run deploy
```

## 运行注意事项

- `refresh` 会把你的 `/mine/readbook` 同步进 D1
- `/api/readbooks` 返回的是本地缓存，不是实时代理微信读书
- 好友同步依赖保存在 D1 中的增量游标 `synckey / syncver`
- 当 `vid` 发生变化时，Worker 会自动重置增量同步状态
- `/mine/readbook` 的分页逻辑基于当前 WeRead 返回的 `synckey + hasMore` 机制
