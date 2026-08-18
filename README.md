# DSH Tailnet Mobile

Tailnet-first remote control for DeepSeek Harness: use an Android app to unlock and control `DSH Web` on Windows over Tailscale, then open both the mobile `/m` UI and original web UI through Tailscale Serve HTTPS.

**Language / 语言**: [中文](README.zh-CN.md) | [English](README.en-US.md)

## Quick Links

- [Install Guide / 安装指南](docs/安装指南.md)
- [Changelog](CHANGELOG.md)
- [Security Policy](SECURITY.md)
- [Releases](releases/)
- [Android App README](android/README.md)
- [Plugin README](plugin/README.md)

## Quick Start (Checklist)

- [ ] Install and sign in to Tailscale on both Windows and Android.
- [ ] Prepare Windows OpenSSH Server and a `DSH Web` scheduled task.
- [ ] Install `releases/dsh-tailnet-mobile-plugin-1.0.1.tgz` to DSH.
- [ ] Configure Tailscale Serve to proxy DSH (`127.0.0.1:3080`).
- [ ] Install `releases/dsh-mobile-v1.3.0.apk`, fill SSH + Serve settings, verify SSH host key fingerprint on first connect.

## Security Note

- Access control is not based on MagicDNS name secrecy.
- DSH stays on loopback (`127.0.0.1:3080`), while external access is through Tailscale Serve HTTPS.
- Tailnet identity/capability checks are enforced by Serve + plugin policy.  
  See [SECURITY.md](SECURITY.md) for full details.

## License

This repository is licensed under the **BSD 3-Clause License**. See [LICENSE](LICENSE).
