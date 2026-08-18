# DSH Mobile

一个 Tailnet 模式的 Android 控制器。它通过 SSH 连接 Windows 电脑，启动、查询或停止计划任务 `DSH Web`，并提供移动端 Harness 与原始 Web Harness 的入口。

## 连接配置

- SSH 主机：首次安装时填写 Tailscale IP 或 MagicDNS
- SSH 端口：`22`
- Windows 用户：首次安装时填写
- Windows 计划任务：`DSH Web`
- DSH Web 端口：`3080`
- Tailscale Serve 根地址：首次安装时填写 `https://电脑MagicDNS名称`

主机、端口、用户名、Tailscale Serve 根地址都可以在 App 登录前修改并保存。

## 手机使用流程

1. 安装 `dsh-mobile-v1.3.0.apk`。这是本地自签名 APK，Android 可能要求允许“安装未知应用”。
2. App 会检测 VPN 并请求已安装、已登录的 Tailscale 连接。
3. 如果系统尚未授予 Tailscale VPN 权限，或者后台自动连接未完成，App 会自动打开 Tailscale；首次使用只需在系统/Tailscale 界面确认一次。
4. 返回 DSH Mobile，填写 SSH 连接参数与 Tailscale Serve 根地址。
5. 输入 Windows **账户密码**，而不是 Windows Hello PIN，然后点“连接并解锁”。
6. 首次连接时核对 SSH 主机指纹，再选择“信任此电脑”。
7. 使用“启动 / 状态 / 停止”。启动成功后可直接打开移动端或原始 Web。
8. 用完点击“锁定并清除密码”，或关闭 App。

App 会请求 Tailscale 建立 VPN，但不会在退出时断开 VPN。由于 Android 的 VPN 授权和后台启动限制，首次授权、Tailscale 未登录或部分 Android 16 场景仍可能需要进入 Tailscale 前台确认。App 不能在电脑关机或睡眠、SSH 无法访问时唤醒电脑；它能在电脑已经在线时远程启动 DSH Web。

## 首次连接时核对指纹

App 优先使用 Windows OpenSSH 的 ECDSA 主机密钥。在电脑的管理员 PowerShell 中运行：

```powershell
ssh-keygen -lf C:\ProgramData\ssh\ssh_host_ecdsa_key.pub -E sha256
```

确认 PowerShell 中的 `SHA256:...` 与 App 对话框完全一致。若协商使用 RSA，则改查：

```powershell
ssh-keygen -lf C:\ProgramData\ssh\ssh_host_rsa_key.pub -E sha256
```

App 会保存已确认的**主机公钥**。如果公钥后来改变，连接会被拒绝；仅在确认电脑重装 OpenSSH 或密钥确实更换后，使用 App 中的“重置信任的 SSH 主机密钥”。

## 电脑端前提

- Tailscale 在线，电脑 Tailnet IP 或 MagicDNS 名称可达。
- Windows `sshd` 服务正在运行，并且防火墙只允许预期的 Tailnet 设备访问 TCP 22。
- 计划任务 `DSH Web` 已存在，并能启动 `dsh web --port 3080 --trusted-host 电脑MagicDNS名称`。
- Tailscale Serve 保持：

```text
https://电脑MagicDNS名称 (tailnet only)
|-- / proxy http://127.0.0.1:3080
```

其他电脑可以直接访问上面的两个 HTTPS 地址，但该电脑也必须加入 Tailnet，并在你的 Tailscale ACL / grants 中获得访问 TCP 443 和对应 App Capability 的权限。网址本身不会绕过白名单。

## 密码与连接安全

- 密码不会写入 SharedPreferences、文件、日志或剪贴板。
- 登录后只保存在当前 App 进程的可清零字符数组中；每次 SSH 操作使用临时副本，随后立即覆写。
- 显式锁定、Activity 销毁、进程关闭或 15 分钟无操作都会清除密码。
- App 禁止系统截图/最近任务预览，并禁用密码字段的状态保存和自动填充。
- SSH 使用首次信任后固定主机公钥；主机密钥发生变化时默认拒绝连接。
- SSH 只协商 Android 8+ 原生支持的 ECDSA/RSA 主机密钥、ECDH/DH-SHA256 密钥交换和 AES-GCM/CTR 加密。

## 源码构建

工程为原生 Android Java，无 Compose。推荐使用 Android Studio，JDK 17、Android SDK 35。工程依赖 `com.github.mwiede:jsch:2.28.6`。

发行包由本机构建并使用个人自签名证书签名。以后更新 App 时必须保留同一签名密钥，否则 Android 会把它视为另一个签名者并拒绝覆盖安装。签名密钥不包含在公开源码或 GitHub 仓库内。

## 已知边界

- 没有实现 Termux、Wake-on-LAN、电脑关机启动或任意文件夹选择。
- 自动连接依赖 Tailscale Android 当前公开的 `CONNECT_VPN` 广播；如果未来版本移除或限制该入口，App 会退回到打开 Tailscale 前台。
- Android 可能在极端内存压力下直接终止进程而不调用生命周期回调；这会连同进程内密码一起销毁。
- 此版本针对当前一台 Windows 电脑和一个 DSH 计划任务设计。
