# DSH Tailnet Mobile（中文）

[返回入口 README](README.md) | [English](README.en-US.md)

## 项目概述

DSH Tailnet Mobile 是一个 Tailnet 优先的远程控制方案：通过 Tailscale 组网，让 Android 手机在不同网络下远程控制 Windows 电脑上的 `DSH Web` 计划任务，并访问移动端 `/m` 与原始 Web 界面。

最终用户通常只需要两个发布物：

1. `releases/dsh-mobile-v1.3.0.apk`（Android 控制器）
2. `releases/dsh-tailnet-mobile-plugin-1.0.1.tgz`（DSH 插件）

源码位于 `android/` 与 `plugin/`。仓库不包含 APK 签名私钥、Windows 密码或 Tailnet 登录凭据。

## 功能特性

- App 打开时检测 VPN，并请求 Tailscale 建立连接。
- 通过 SSH（Windows 账户密码）远程启动、查询、停止 Windows 计划任务 `DSH Web`。
- 一键打开移动端 `/m` 与原始 Harness Web。
- Tailnet 内手机可直接访问 `https://<电脑>.tailnet.ts.net/m`；可结合 Serve 身份头与 app capability 进行门禁。
- 首次 SSH 连接显示主机公钥指纹，确认后固定主机公钥。
- SSH 密码仅在 App 进程内存驻留，锁定/退出/闲置 15 分钟后清除。
- 移动端支持审批请求操作、提问选项同步和 `dsh-cost-meter` 余额查询。

## 快速开始

完整步骤见 [安装指南](docs/安装指南.md)。推荐顺序：

1. 在 Windows 与 Android 安装并登录 Tailscale。
2. Windows 准备 OpenSSH Server，确保 `sshd` 运行，创建计划任务 `DSH Web`。
3. 安装插件包：
   ```powershell
   dsh plugin --profile web add .\dsh-tailnet-mobile-plugin-1.0.1.tgz
   ```
4. 配置 Tailscale Serve 代理到 `127.0.0.1:3080`：
   ```powershell
   & "C:\Program Files\Tailscale\tailscale.exe" serve --bg 3080
   ```
5. 安装 APK，填写 SSH 主机/端口/用户名与 Serve 根地址（`https://电脑MagicDNS名称`），首次连接核对 SSH 指纹。

## 安全说明

- DSH Web 保持监听 `127.0.0.1:3080`，通过 Tailscale Serve 暴露 HTTPS 入口。
- MagicDNS 仅负责解析，不是访问控制边界。
- 可用 grants/app capability 做细粒度授权；插件会校验 loopback 代理身份与同源条件。
- 局域网桥接能力默认受限，需显式白名单；公共网络不应使用未加密 HTTP。
- 公开反馈问题时，不要泄露 Windows 密码、SSH 私钥、Tailnet auth key 或签名私钥。

更多细节请查看 [SECURITY.md](SECURITY.md)。

## 当前边界与限制

- 不支持 Wake-on-LAN，目标电脑必须已开机、联网且 `sshd` 可达。
- 不实现 Termux 集成。
- 不提供手机端任意文件夹选择能力。
- 首次 VPN 授权、Tailscale 未登录或系统限制后台启动时，可能仍需在 Tailscale 前台确认一次。
- Android 在极端内存压力下可能直接杀进程；进程内凭据会随进程销毁。

## License

本仓库采用 **BSD 3-Clause License**。详见 [LICENSE](LICENSE)。
