# CrashBandit ADB Tool

A browser-based ADB interface. Connect Android devices over Wi-Fi, manage apps, browse files, screencast the display and run shell commands — no USB cable needed.

## Requirements
- Docker
- Android device with Developer Options + Wireless Debugging enabled (Android 11+)

## Android Device Setup

1. Go to **Settings → About Phone** and tap **MIUI Version** / **HyperOS Version** 7 times to enable Developer Options
2. Go to **Settings → Additional Settings → Developer Options** and enable:
   - **USB Debugging**
   - **USB Debugging (Security Settings)** ← important on Xiaomi
   - **Wireless Debugging**
3. Tap **Wireless Debugging** → **Pair device with pairing code**
4. Enter the IP, pairing port and 6-digit code shown on the screen into the PAIR form on the website
5. After pairing, go back to the Wireless Debugging screen and note the **IP and port** shown there
6. Enter that IP and port into the CONNECT form on the website

> **Xiaomi/HyperOS users:** If touch input (screencast tap) does not work, look for **"Allow simulated inputs"** or **"Extended ADB access"** in Developer Options and enable it.

## Install
```bash
git clone https://github.com/CrashBandit82/crashbandit-adb-tool
cd crashbandit-adb-tool
docker build -t crashbandit-adb-tool .
docker run -d --name crashbandit-adb-tool -p 3000:3000 --restart unless-stopped crashbandit-adb-tool
```

Open in browser: `http://localhost:3000`

## Features
- Wireless Pairing & Connect (Android 11+)
- App Manager – install, uninstall, disable, APK export
- File Manager – push & pull files between server and device
- Screencast – live display with touch control
- Interactive Shell – adb shell in the browser
- Default Apps – manage launchers and defaults

## Security

**Set a password.** Create a `.env` file next to `docker-compose.yml`:

```
ADB_TOOL_PASSWORD=choose-a-long-password
```

Then `docker compose up -d --build`. The browser asks for a login – any user name works, the password is the one above. Without a password the tool prints a warning on startup and **everyone on your network gets full shell access to your connected phones**.

Built-in protection (since v1.1.0):
- Optional login via `ADB_TOOL_PASSWORD` (HTTP Basic Auth, also enforced for the console and screen WebSockets)
- Same-origin check: other websites you visit cannot drive the tool through your browser
- Package names, components and device paths are validated / quoted before they reach the phone's shell
- ADB platform-tools pinned to a fixed version and verified by SHA-256

Run only on a trusted private network. Never expose port 3000 to the public internet.

## License
Custom non-commercial license — see LICENSE file.
