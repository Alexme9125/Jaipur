# Jaipur · 斋普尔

双人香料贸易桌游的 Web 版实现，规则见 [RULES.md](./RULES.md)。

## 特性

- **人机练习**：三种 AI 人格（谨慎 / 平衡 / 激进），本地对局可随时存档继续。
- **好友对战**：创建房间拿 5 位房间码，朋友打开邀请链接即进房；支持旁观、断线重连、房主转让、回合计时与超时系统代走。
- **规则面板**：开局前由房主调整规则选项（换牌限制、牌堆见底触发、平局判定、回合数、计时等）。
- **共享规则引擎**：规则引擎是确定性纯函数，客户端和服务端共用同一份代码；联网对局由服务端校验每一步。

## 本地开发

```bash
npm install
npm run dev        # 同时起 Vite (5173) 和游戏服务器 (8787)，/ws 自动代理
```

其他命令：`npm run typecheck`（类型检查）、`npm test`（引擎 + 服务端测试）。

## 生产运行

```bash
npm run build      # 打包客户端到 dist/client，服务端到 dist/server
npm start          # node dist/server/index.js
```

环境变量：`PORT`（默认 8787）、`HOST`（默认 0.0.0.0）。健康检查：`GET /healthz` → `ok`。

## Docker

```bash
docker build -t jaipur .
docker run -p 8787:8787 jaipur
```

## 反向代理（Nginx）

WebSocket 端点在 `/ws`，需要转发 Upgrade 头：

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
}

location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

## 说明

- 房间和对局全部存在**内存**里：服务重启后所有房间消失，断线的玩家有 30 秒重连宽限。
- 你的昵称与历史战绩存在浏览器 `localStorage`，联机身份用 `jaipur.clientId` 随机密钥，刷新页面不会丢座位。
- 记分单位：1 卢比 = 1K Tokens（K/M/G 为千 / 百万 / 十亿，进率 1000）。
