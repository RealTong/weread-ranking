# weread-ranking

一个部署在 Cloudflare Workers 上的微信读书数据同步服务。

它解决两个实际问题：

- 微信读书 `skey` 有效期短，不适合直接写死在环境变量里
- 好友榜、阅读历史、个人书单这些数据更适合定时同步到本地数据库，再通过稳定 API 对外提供

这个项目的设计是：

- 外部脚本或手动操作负责获取最新微信读书完整凭证
- Worker 提供一个凭证写入 API，把最新凭证写入 D1
- Worker 定时同步微信读书数据到 D1
- Web、脚本、自动化任务都只读本项目自己的 API

## 功能

- 同步微信读书好友阅读总时长
- 同步好友周榜数据
- 同步你的个人历史书单 `/mine/readbook`
- 通过 D1 持久化微信读书凭证、同步游标和快照数据
- 提供可直接消费的 HTTP API

## 技术栈

- Cloudflare Workers
- Hono
- Cloudflare D1
- Bun

## 数据流

1. 通过 `POST /api/admin/weread/credentials` 更新当前可用的微信读书完整凭证
2. `POST /api/admin/refresh` 或兼容别名 `POST /api/refresh` 触发同步
3. Worker 从 D1 读取当前凭证
4. Worker 拉取微信读书数据并写入 D1
5. 业务侧通过 `/api/aio`、`/api/friends`、`/api/ranking`、`/api/readbooks` 读取 D1 本地缓存数据

## 前置要求

- 一个 Cloudflare 账号
- 已安装 [Bun](https://bun.sh/)
- 已安装并登录 [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 创建 D1

先创建 D1 数据库：

```bash
bunx wrangler d1 create weread-ranking
```

### 3. 更新 `wrangler.jsonc`

把你自己的 D1 `database_id` 填进去。

默认需要确认这些字段：

- `d1_databases[0].database_id`
- `triggers.crons`

默认 cron 是每小时执行一次：

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

### 4. 配置本地环境变量

复制示例文件：

```bash
cp .dev.vars.example .dev.vars
```

填入：

```bash
API_KEY="replace-with-a-long-random-string"
CORS_ORIGIN="http://localhost:3000"
```

说明：

- `API_KEY` 用于保护所有管理和查询接口
- `CORS_ORIGIN` 可选；如果前端和 Worker 不同源，可以配置允许访问的域名，多个域名用逗号分隔

### 5. 执行数据库迁移

本地开发：

```bash
bun run migrate:local
```

部署到 Cloudflare 后执行远程迁移：

```bash
bun run migrate:remote
```

### 6. 启动本地开发服务

```bash
bun run dev
```

默认地址：

```text
http://localhost:8787
```

## 首次使用流程

本项目第一次启动后，建议按下面顺序执行。

### 1. 上传微信读书完整凭证

拿到最新的完整凭证 JSON 后，调用：

```bash
curl -X POST "http://localhost:8787/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "your-latest-skey",
    "accessToken": "your-access-token",
    "refreshToken": "your-refresh-token",
    "basever": "10.1.0.80",
    "appver": "8.2.4.101",
    "v": "10.1.0.80",
    "channelId": "AppStore",
    "userAgent": "WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)",
    "osver": "16.7.12",
    "baseapi": 303
  }'
```

如果你更换了账号，或者希望强制从头同步游标，可以加上 `resetSync: true`：

```json
{
  "vid": "449518091",
  "skey": "your-latest-skey",
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token",
  "basever": "10.1.0.80",
  "appver": "8.2.4.101",
  "v": "10.1.0.80",
  "channelId": "AppStore",
  "userAgent": "WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)",
  "osver": "16.7.12",
  "baseapi": 303,
  "resetSync": true
}
```

### 2. 手动触发一次同步

```bash
curl -X POST "http://localhost:8787/api/admin/refresh" \
  -H "x-api-key: <API_KEY>"
```

兼容旧调用方式时，也可以继续使用：

```bash
curl -X POST "http://localhost:8787/api/refresh" \
  -H "x-api-key: <API_KEY>"
```

### 3. 查询同步结果

```bash
curl "http://localhost:8787/api/aio" \
  -H "x-api-key: <API_KEY>"
```

## 部署

部署 Worker：

```bash
bun run deploy
```

部署后，把 `API_KEY` 写入 Cloudflare Secret：

```bash
bunx wrangler secret put API_KEY
```

部署完成后，调用线上地址上传凭证：

```bash
curl -X POST "https://<your-worker-domain>/api/admin/weread/credentials" \
  -H "x-api-key: <API_KEY>" \
  -H "content-type: application/json" \
  -d '{
    "vid": "449518091",
    "skey": "your-latest-skey",
    "accessToken": "your-access-token",
    "refreshToken": "your-refresh-token",
    "basever": "10.1.0.80",
    "appver": "8.2.4.101",
    "v": "10.1.0.80",
    "channelId": "AppStore",
    "userAgent": "WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)",
    "osver": "16.7.12",
    "baseapi": 303
  }'
```

发布说明：

- 已有部署在升级到这次重构后，必须重新调用 `POST /api/admin/weread/credentials` 上传一份新的完整凭证 JSON
- 旧的 `weread_session` 数据不会自动迁移到 `weread_credentials`
- 如果只部署代码但不补传完整凭证，后续刷新会因为缺少当前凭证而失败

## 凭证更新说明

微信读书凭证可能变化较快，这个项目不依赖长期环境变量来保存它。

推荐做法：

- 外部脚本定期获取新的完整凭证 JSON
- 调用 `POST /api/admin/weread/credentials`
- Worker 把最新凭证写入 D1
- 后续定时同步始终使用 D1 中的最新凭证

也就是说，真正需要长期保存的环境变量只有：

- `API_KEY`
- `CORS_ORIGIN`，可选

## API 说明

所有 `/api/*` 接口都要求：

```http
x-api-key: <API_KEY>
```

所有查询接口都只读取 D1 中的缓存数据，不会实时代理微信读书请求。

### `POST /api/admin/weread/credentials`

更新当前微信读书完整凭证。

请求体：

```json
{
  "vid": "449518091",
  "skey": "your-latest-skey",
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token",
  "basever": "10.1.0.80",
  "appver": "8.2.4.101",
  "v": "10.1.0.80",
  "channelId": "AppStore",
  "userAgent": "WeRead/10.1.0 (iPhone; iOS 16.7.12; Scale/3.00)",
  "osver": "16.7.12",
  "baseapi": 303
}
```

可选字段：

- `resetSync: true` 会重置增量同步游标

### `GET /api/admin/weread/credentials`

查看当前凭证是否已配置，以及最近更新时间。

### `POST /api/admin/refresh`

立即执行一次同步。

同步内容包括：

- 好友阅读总时长
- 好友排行榜
- 你的个人历史书单

### `POST /api/refresh`

兼容旧调用方式的别名，行为与 `POST /api/admin/refresh` 一致。

### `GET /api/aio`

返回聚合后的好友信息和最新周榜，适合前端一次性加载。数据来自 D1 缓存。

示例：

```bash
curl "http://localhost:8787/api/aio" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/friends`

返回好友列表和最新累计阅读时长。数据来自 D1 缓存。

查询参数：

- `limit`
- `offset`

示例：

```bash
curl "http://localhost:8787/api/friends?limit=100&offset=0" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/ranking`

返回最新一次同步得到的好友周榜。数据来自 D1 缓存。

示例：

```bash
curl "http://localhost:8787/api/ranking" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/friends/:userVid/history`

返回某个好友的历史阅读变化。数据来自 D1 缓存。

查询参数：

- `limit`

示例：

```bash
curl "http://localhost:8787/api/friends/123456/history?limit=100" \
  -H "x-api-key: <API_KEY>"
```

### `GET /api/readbooks`

返回同步到 D1 的个人历史书单缓存。

查询参数：

- `limit`
- `offset`
- `markStatus`

其中：

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

## 调试请求示例

仓库里提供了两个调试文件：

- [request.http](./request.http)
- [test.http](./test.http)

可以直接在支持 `.http` 文件的编辑器中发请求。

## 常用命令

```bash
bun run dev
bun run test
bun run typecheck
bun run migrate:local
bun run migrate:remote
bun run deploy
```

## 注意事项

- `refresh` 会同步你的个人历史书单 `/mine/readbook`，并把结果缓存到 D1
- `/api/readbooks` 读取的是本地缓存，不是实时代理微信读书
- 好友同步依赖增量游标 `synckey / syncver`，这些状态会保存在 D1
- 如果更换了 `vid`，Worker 会自动重置增量同步游标
- `/mine/readbook` 的分页逻辑基于微信读书当前返回的 `synckey + hasMore` 机制实现
