# DSH Tailnet Mobile (English)

[Back to entry README](README.md) | [中文](README.zh-CN.md)

## Overview

DSH Tailnet Mobile is a Tailnet-first remote control workflow for DeepSeek Harness. It lets an Android phone securely control a Windows-hosted `DSH Web` scheduled task over Tailscale, then open both the mobile `/m` UI and the original web UI via Tailscale Serve HTTPS.

Most users only need these release artifacts:

1. `releases/dsh-mobile-v1.3.0.apk` (Android controller)
2. `releases/dsh-tailnet-mobile-plugin-1.0.1.tgz` (DSH plugin)

Source code lives in `android/` and `plugin/`. This repository does not include APK signing keys, Windows passwords, or Tailnet login credentials.

## Features

- Detects VPN state and requests Tailscale connection from the app.
- Uses SSH with Windows account password to start/check/stop the `DSH Web` scheduled task remotely.
- One-tap entry to both mobile `/m` and the original Harness web UI.
- Tailnet devices can access `https://<computer>.tailnet.ts.net/m` directly, with Serve identity headers and optional app capability gating.
- Verifies SSH host key fingerprint on first connection and pins the trusted host key.
- Keeps SSH password in process memory only; clears on lock, exit, or 15 minutes of inactivity.
- Mobile UI supports approval actions, prompt option sync, and `dsh-cost-meter` balance checks.

## Quick Start

For full details, read the [Install Guide](docs/安装指南.md). Recommended flow:

1. Install and sign in to Tailscale on both Windows and Android.
2. On Windows, prepare OpenSSH Server (`sshd`) and create the `DSH Web` scheduled task.
3. Install the plugin package:
   ```powershell
   dsh plugin --profile web add .\dsh-tailnet-mobile-plugin-1.0.1.tgz
   ```
4. Configure Tailscale Serve to proxy `127.0.0.1:3080`:
   ```powershell
   & "C:\Program Files\Tailscale\tailscale.exe" serve --bg 3080
   ```
5. Install the APK, fill SSH host/port/username and Serve base URL (`https://<MagicDNS-name>`), then verify SSH fingerprint on first connect.

## Security

- `DSH Web` remains bound to loopback (`127.0.0.1:3080`), with HTTPS exposure handled by Tailscale Serve.
- MagicDNS is naming/routing only, not an authorization boundary.
- Fine-grained authorization can be enforced via grants/app capability; plugin logic checks loopback Serve identity and same-origin conditions.
- LAN bridge behavior is intentionally restricted and requires explicit allowlisting; unencrypted HTTP should not be used on untrusted networks.
- Do not post secrets in public issues (Windows passwords, SSH private keys, Tailnet auth keys, signing keys).

See [SECURITY.md](SECURITY.md) for the full security model.

## Limitations

- No Wake-on-LAN support; target machine must already be online with reachable `sshd`.
- No Termux integration.
- No arbitrary folder picker from mobile.
- First-time VPN authorization, signed-out Tailscale, or Android background limits may still require one foreground confirmation in Tailscale.
- Under extreme memory pressure, Android may kill the app process directly; in-memory credentials are destroyed with the process.

## License

This repository is licensed under the **BSD 3-Clause License**. See [LICENSE](LICENSE).
