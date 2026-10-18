<p align="right"><b>English</b> · <a href="README.de.md">Deutsch</a></p>

<p align="center"><img src="public/logo.png" width="96" alt="CrashBandit ADB Tool"></p>

<h1 align="center">CrashBandit ADB Tool</h1>

<p align="center">A browser-based ADB interface. Connect Android devices over Wi-Fi, manage apps, browse files, screencast the display and run shell commands – no USB cable needed.</p>

---

## Features

- **Wireless pairing & connect** (Android 11+)
- **App manager** – list, uninstall, disable/enable, APK export
- **File manager** – push & pull files between server and device
- **Screencast** – live display with touch control
- **Interactive shell** – `adb shell` in the browser
- **Default apps** – manage launchers and defaults

## Requirements

- Docker
- Android device with Developer Options and Wireless Debugging enabled (Android 11+)

## Install

```bash
git clone https://github.com/CrashBandit82/crashbandit-adb-tool
cd crashbandit-adb-tool
echo "ADB_TOOL_PASSWORD=choose-a-long-password" > .env
docker compose up -d --build
```

Open `http://<host>:3000` in the browser. The browser asks for a login – any user name works, the password is the one from `.env`.

`docker-compose.yml` uses `network_mode: host`, which makes Wi-Fi pairing (mDNS) work reliably.

## Android device setup

1. **Settings → About phone** – tap the build number (Xiaomi: **MIUI/HyperOS version**) 7 times to enable Developer Options.
2. In **Developer Options** enable:
   - **USB debugging**
   - **USB debugging (Security settings)** ← important on Xiaomi
   - **Wireless debugging**
3. Tap **Wireless debugging → Pair device with pairing code**.
4. Enter the IP, pairing port and 6-digit code into the **PAIR** form.
5. Back on the Wireless debugging screen, note the **IP and port** shown there.
6. Enter that IP and port into the **CONNECT** form.

> **Xiaomi/HyperOS:** if tapping in the screencast does not work, enable **"Allow simulated inputs"** or **"Extended ADB access"** in Developer Options.

## Security

**Always set a password** (`ADB_TOOL_PASSWORD`). Without it the tool prints a warning on startup and **everyone on your network gets full shell access to your connected phones**.

Built-in protection (since v1.1.0):
- Login via `ADB_TOOL_PASSWORD` (HTTP Basic Auth, also for the console and screen WebSockets)
- Same-origin check: other websites you visit cannot drive the tool through your browser
- Package names, components and device paths are validated / quoted before they reach the phone's shell
- ADB platform-tools pinned to a fixed version and verified by SHA-256

Run only on a trusted private network. Never expose port 3000 to the public internet.

## License

Copyright (C) 2026 CrashBandit82

CrashBandit ADB Tool is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License v3.0** as published by the Free Software Foundation. If you run a modified version as a network service, you must make its source code available to its users. See [LICENSE](LICENSE) for the full text.
