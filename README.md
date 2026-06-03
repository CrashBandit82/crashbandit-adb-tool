# CrashBandit ADB Tool

A browser-based ADB interface. Connect Android devices over Wi-Fi, manage apps, browse files, screencast the display and run shell commands — no USB cable needed.

## Requirements
- Docker
- Android device with Developer Options + Wireless Debugging enabled (Android 11+)

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

## Warning
Run only on a trusted private network. Never expose port 3000 to the public internet.

## License
Custom non-commercial license — see LICENSE file.
