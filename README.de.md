<p align="right"><a href="README.md">English</a> · <b>Deutsch</b></p>

<p align="center"><img src="public/logo.png" width="96" alt="CrashBandit ADB Tool"></p>

<h1 align="center">CrashBandit ADB Tool</h1>

<p align="center">ADB im Browser. Android-Geräte per WLAN verbinden, Apps verwalten, Dateien durchsuchen, den Bildschirm übertragen und Shell-Befehle ausführen – ganz ohne USB-Kabel.</p>

---

## Funktionen

- **Kabellos koppeln & verbinden** (Android 11+)
- **App-Verwaltung** – auflisten, deinstallieren, deaktivieren/aktivieren, APK exportieren
- **Dateimanager** – Dateien zwischen Server und Gerät hin- und herschieben
- **Bildschirm übertragen** – Live-Anzeige mit Touch-Steuerung
- **Interaktive Shell** – `adb shell` im Browser
- **Standard-Apps** – Launcher und Standard-Apps festlegen

## Voraussetzungen

- Docker
- Android-Gerät mit aktivierten Entwickleroptionen und kabellosem Debugging (Android 11+)

## Installation

```bash
git clone https://github.com/CrashBandit82/crashbandit-adb-tool
cd crashbandit-adb-tool
echo "ADB_TOOL_PASSWORD=ein-langes-passwort" > .env
docker compose up -d --build
```

Im Browser `http://<host>:3000` öffnen. Der Browser fragt nach einer Anmeldung – der Benutzername ist egal, das Passwort ist das aus `.env`.

`docker-compose.yml` nutzt `network_mode: host`, damit das Koppeln per WLAN (mDNS) zuverlässig klappt.

## Android-Gerät einrichten

1. **Einstellungen → Über das Telefon** – 7-mal auf die Build-Nummer tippen (Xiaomi: **MIUI-/HyperOS-Version**), um die Entwickleroptionen freizuschalten.
2. In den **Entwickleroptionen** einschalten:
   - **USB-Debugging**
   - **USB-Debugging (Sicherheitseinstellungen)** ← wichtig bei Xiaomi
   - **Kabelloses Debugging**
3. **Kabelloses Debugging → Gerät über Kopplungscode koppeln** antippen.
4. IP, Kopplungs-Port und 6-stelligen Code ins Formular **PAIR** eintragen.
5. Zurück im Bildschirm „Kabelloses Debugging“ die dort angezeigte **IP und den Port** notieren.
6. Diese IP und diesen Port ins Formular **CONNECT** eintragen.

> **Xiaomi/HyperOS:** Wenn das Tippen in der Bildschirmübertragung nicht funktioniert, in den Entwickleroptionen **„Simulierte Eingaben zulassen“** bzw. **„Erweiterter ADB-Zugriff“** einschalten.

## Sicherheit

**Immer ein Passwort setzen** (`ADB_TOOL_PASSWORD`). Ohne Passwort warnt das Tool beim Start, und **jeder in deinem Netzwerk bekommt vollen Shell-Zugriff auf die verbundenen Handys**.

Eingebauter Schutz (seit v1.1.0):
- Anmeldung über `ADB_TOOL_PASSWORD` (HTTP Basic Auth, auch für Konsole und Bildschirm-WebSockets)
- Herkunftsprüfung: Andere Websites, die du besuchst, können das Tool nicht über deinen Browser steuern
- Paketnamen, Komponenten und Gerätepfade werden geprüft bzw. maskiert, bevor sie an die Shell des Handys gehen
- ADB-Platform-Tools mit fester Version, per SHA-256 geprüft

Nur in einem vertrauenswürdigen privaten Netzwerk betreiben. Port 3000 niemals ins Internet freigeben.

## Lizenz

Copyright (C) 2026 CrashBandit82

CrashBandit ADB Tool ist freie Software: Du darfst es unter den Bedingungen der **GNU Affero General Public License v3.0** der Free Software Foundation weitergeben und verändern. Wer eine veränderte Version als Online-Dienst betreibt, muss den Nutzern den Quellcode zur Verfügung stellen. Der vollständige Text steht in [LICENSE](LICENSE) (rechtlich gilt die englische Fassung).
