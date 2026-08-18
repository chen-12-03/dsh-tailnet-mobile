# Changelog

## 1.3.0

- Android 控制器升级至 v1.3.0：移除“我与电脑在同一局域网”选项，统一走 Tailscale 组网。
- 移动端 Web 现在信任 Tailscale Serve 注入的身份头，Tailnet 内手机打开 `/m` 即可访问工作区/会话，无需二维码或 app capability。
- 移动端界面按原始 Web 配色（#ffffff / #fa9c29 / #545388 / #3e3871）优化。
- 移动端聊天工具栏新增“工具 / 技能”选择器和 dsh-cost-meter 余额查询。
- DSH 插件同步更新：局域网桥默认开启但仅监听本机；诊断 R11 toast 默认注释关闭。

## 1.0.1

- Android 控制器升级至 v1.2.1：局域网模式切换立即保存，并阻止所有已排队的 Tailscale 自动连接与跳转。
- 局域网模式不再强制填写 Tailscale Serve 地址；Tailnet 模式可识别完整 HTTPS URL、MagicDNS 域名以及 `tailscale serve status` 中的地址。
- DSH 插件升级至 v1.0.1：移除 Cloudflared 运行时依赖和自动隧道入口，避免 pnpm 的 `ERR_PNPM_IGNORED_BUILDS`；Tailnet 与白名单局域网功能不受影响。

## 1.0.0

- 提供 Android 控制器 v1.2.0：Tailnet/局域网模式切换、Tailscale 自动连接请求、SSH 内存密码、主机公钥固定、DSH Web 启停与链接入口。
- 提供 DSH 插件 v1.0.0：Tailscale Serve app capability 免二维码通道，以及默认关闭、IPv4/CIDR 白名单控制的移动端专用局域网桥。
- 提供 Tailnet grants 模板、Windows 主机设置脚本、安装指南与安全模型。
