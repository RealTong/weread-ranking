# weread-ranking web UI (shadcn/ui + Vite)

一个简单的 Web UI，用来展示 `/api/aio` 的朋友阅读数据，以及 `/api/friends/:userVid/history` 的历史变化。

## 本地开发

1) 先启动 Worker（默认端口 `8787`）：

```bash
cd ..
bun run dev
```

2) 再启动 Web UI（默认端口 `5173`）：

```bash
cd web
bun install
bun run dev
```

本项目已在 `web/vite.config.ts` 配置了 `/api` → `http://127.0.0.1:8787` 的开发代理，所以 Web UI 默认可以直接调用 `/api/*` 而不需要额外 CORS 配置。

## 设置

打开页面右上角「设置」：
- `API Base URL`：可留空（默认同域/代理），或填你的 Worker 线上地址
- `API Key`：如果 Worker 配了 `API_KEY`，这里需要填写

## 构建

```bash
cd web
bun run build
```
