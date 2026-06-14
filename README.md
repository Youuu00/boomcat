# 炸弹猫咪

一个无需第三方依赖的 2–6 人实时卡牌游戏。Node.js 服务端负责洗牌、手牌保密和规则判定，浏览器通过 SSE 实时同步。

## 本地启动

```powershell
cd E:\模式识别\lab2\boomcat
& 'C:\Program Files\nodejs\node.exe' server.js
```

电脑访问 `http://localhost:3000`。同一 Wi-Fi 下的朋友访问 `http://电脑局域网IP:3000`。

## 免费部署到 Render

项目根目录已包含 `render.yaml`，配置为新加坡区域的免费 Node.js Web Service。

1. 将 `boomcat` 目录上传到一个 GitHub 仓库。
2. 登录 [Render Dashboard](https://dashboard.render.com/)。
3. 点击 `New +`，选择 `Blueprint`。
4. 连接刚才的 GitHub 仓库。
5. Render 会读取 `render.yaml`，确认后点击部署。
6. 部署成功后，打开 Render 提供的 `https://...onrender.com` 地址。

所有玩家打开同一个公网地址，创建房间或输入 6 位房间码即可联机，不需要处于同一局域网。

## 免费实例限制

- 免费服务闲置后可能休眠，首次访问需要等待服务唤醒。
- 房间保存在内存中。服务休眠、重启或重新部署后，已有房间会消失。
- 适合朋友临时游玩，不适合长期保存账号、战绩或未结束的牌局。
- SSE 连接每 20 秒发送一次心跳，降低公网代理断开实时连接的概率。

## 健康检查

部署后访问 `/health`，正常结果类似：

```json
{"ok":true,"rooms":0,"uptime":12}
```

## 测试

```powershell
& 'C:\Program Files\nodejs\node.exe' test\smoke.js
```
