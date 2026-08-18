# Security

## Tailnet 模式

- DSH Web 只监听 `127.0.0.1`。
- Tailscale Serve 终止 HTTPS，并代理到 `127.0.0.1:3080`。
- grants 只向获准设备发放 `<tailnet>.ts.net/cap/dsh-mobile`。
- Serve 会剥离调用者伪造的 Tailscale 身份头，再注入实际 capability。
- 插件仅在后端连接为 loopback、capability 匹配且浏览器同源时免除二维码配对。

MagicDNS 只负责名称解析，不是访问控制。设备名和 IP 地址也不是秘密。

## 局域网模式

- 默认关闭。
- 单独监听端口 3081，只代理 `/m` 和 `/m/*`；其他路径返回 404。
- 必须设置明确的 IPv4 或 CIDR 白名单；空白名单不会启动。
- 代理到 DSH 的内部请求使用每次进程启动随机生成的秘密标记。
- 应在 Windows 防火墙中重复限制允许的远端地址。
- HTTP 流量没有传输加密，不应在公共 Wi-Fi 或不可信局域网使用。

## Android 凭据

- Windows 密码不写入文件、SharedPreferences、日志或剪贴板。
- 密码仅驻留 App 进程内存，操作时使用临时副本并尽快覆写。
- 锁定、Activity 销毁或 15 分钟闲置后清除。
- SSH 主机公钥指纹首次确认后固定；密钥变化默认拒绝。
- 发布仓库不包含 APK 签名私钥。

## 报告问题

在公开 issue 中不要粘贴 Windows 密码、SSH 私钥、Tailnet auth key、完整策略中的敏感用户信息或 APK 签名私钥。
