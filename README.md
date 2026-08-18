<<<<<<< HEAD
# DSH Tailnet Mobile

> 基于组网的远程控制：通过 Tailscale 组网，在不同网络下从 Android 手机启动、停止并使用 DeepSeek Harness 移动端界面。移动端和原始 Web 都通过 Tailscale Serve 的 HTTPS 入口访问。

## 发布物

最终用户只安装两个核心文件：

1. `releases/dsh-mobile-v1.3.0.apk`：Android 控制器。
2. `releases/dsh-tailnet-mobile-plugin-1.0.1.tgz`：DSH/Harness 插件（Tailnet-only，不依赖 Cloudflared）。

源码分别位于 `android/` 和 `plugin/`。签名密钥、Windows 密码、Tailnet 登录凭据均不在仓库中。

## 能做什么

- App 打开时检测 VPN，并请求 Tailscale 建立连接。
- 通过 SSH 密码临时解锁，远程启动、查询、停止 Windows 计划任务 `DSH Web`。
- 一键打开移动端 `/m` 和原始 Harness Web 地址。
- Tailnet 内手机无需二维码即可使用 `/m`；Tailscale Serve 身份头或 app capability 均可放行。
- SSH 首次连接显示主机公钥指纹；确认后固定该公钥。
- SSH 密码只存在 App 进程内存中，锁定、退出或闲置 15 分钟后清除。
- 移动端可同步电脑端的审批请求（允许一次 / 拒绝）和提问选项，并支持自定义回答。
- 移动端可调用 dsh-cost-meter 查询余额。

## 网络模式

| 模式 | 手机入口 | 身份边界 | 是否自动请求 Tailscale |
| --- | --- | --- | --- |
| Tailnet | `https://电脑名.tailnet.ts.net/m` | Tailscale Serve 身份 / grants + app capability | 是 |

DSH 本体始终使用安全的 `127.0.0.1:3080`，不需要也不允许 `dsh web --host 0.0.0.0`。移动端通过 Tailscale Serve 的 HTTPS 入口访问。

## 快速开始

完整步骤见 [安装指南](docs/安装指南.md)。基本顺序是：

1. 电脑和手机安装、登录 Tailscale。
2. Windows 准备 OpenSSH Server 和计划任务 `DSH Web`。
3. 安装插件 tarball。
4. 配置 Tailscale Serve（如需更严格门禁，可再配置 app capability / grants）。
5. 手机安装 APK，填写 SSH 主机、用户名与 Tailscale Serve 根地址。

## 安全说明

本项目不会让 MagicDNS 名称本身充当白名单。真正的远程授权来自 Tailscale grants 发放的 app capability，插件还要求该 capability 由 loopback Serve 代理注入并通过同源检查。详见 [SECURITY.md](SECURITY.md)。

## 当前边界

- 不实现 Wake-on-LAN；电脑必须已经开机、联网且 `sshd` 可达。
- 不实现 Termux。
- 不实现手机选择电脑任意文件夹。
- Android 首次 VPN 授权、Tailscale 未登录或系统限制后台启动时，仍可能需要在 Tailscale 前台确认一次。

## License

Apache-2.0。插件基于 `@linxin666/dsh-remote-web-ui` 的 Apache-2.0 代码修改并保留原许可。
=======
# dsh-tailnet-mobile
>>>>>>> 67ca53082f9dd23055acc312a3a3a8c2d5488a9e
