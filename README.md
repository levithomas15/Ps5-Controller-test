# DualSense Studio

Eine Website, mit der sich ein **PS5-DualSense-Controller direkt im Browser** (Chrome/Edge auf dem MacBook)
ansprechen lässt – ohne Installation, ohne Server, ohne Datenübertragung.

## Funktionen

- **Verbinden** per USB-C-Kabel oder Bluetooth über WebHID
- **Lightbar-Farbe** frei wählbar (Farbrad, RGB-Regler, Helligkeit, Voreinstellungen)
- **Effekte**: Regenbogen, Atmen, Puls, Akkustandsanzeige, Reaktion auf die Trigger
- **Player-LEDs** und **Mikrofon-LED** schalten
- **Adaptive Trigger** pro Seite ein-/ausschalten und konfigurieren
  (Widerstand, Waffe, Vibration, Bogen, Galopp, Maschine) inklusive Spiel-Voreinstellungen
- **Stickdrift-Test** mit zwei Messungen:
  - *Ruhetest* – wie weit wandern die Sticks unberührt aus der Mitte?
  - *Kreistest* – wird der volle Bewegungsbereich rund erreicht?
- **Tastentest**, Touchpad-Anzeige, Akkustand und Vibrationstest

## Benutzung

Die Seite ist statisch. Entweder direkt auf GitHub Pages veröffentlichen oder lokal starten:

```bash
python3 -m http.server 8000
# danach http://localhost:8000 in Chrome öffnen
```

WebHID braucht einen **sicheren Kontext**: `https://…` oder `localhost`. Ein direkt geöffnetes
`file://`-Dokument funktioniert nicht.

## Voraussetzungen

| | |
|---|---|
| Browser | Chrome, Edge, Brave, Arc oder Opera (Chromium). **Safari und Firefox unterstützen WebHID nicht.** |
| Controller | DualSense (CFI-ZCT1) oder DualSense Edge |
| Verbindung | USB-C-Datenkabel oder Bluetooth-Kopplung mit macOS |

### Bluetooth koppeln

Controller ausschalten, dann **Create + PS-Taste** ca. 5 Sekunden halten, bis die Lightbar schnell blinkt.
Anschließend in den macOS-Systemeinstellungen unter Bluetooth verbinden.

## Wichtig: parallel zur PS5 geht es nicht

Der DualSense kann immer nur **mit einem Gerät gleichzeitig** verbunden sein. Während er an der PS5 hängt,
nimmt er keine Befehle vom Mac entgegen, und die Konsole setzt Lightbar sowie Trigger bei jedem Spielstart
selbst. Alle Einstellungen hier gelten also für den Controller **am Mac** – etwa für Mac-Spiele, Remote Play
oder zum Testen der Hardware.

## Technik

- `src/dualsense.js` – HID-Reports lesen und schreiben (USB-Report `0x02`, Bluetooth-Report `0x31`
  mit Sequenznummer und CRC32)
- `src/crc32.js` – Prüfsumme für Bluetooth-Ausgabereports
- `src/app.js` – Oberfläche, Effekte, Testlogik
- Keine Abhängigkeiten, kein Build-Schritt

Kein offizielles Sony-Produkt. „PlayStation", „PS5" und „DualSense" sind Marken der
Sony Interactive Entertainment Inc.

## Tests

```bash
node tests/protocol.test.mjs
```

Prüft ohne Browser den Aufbau der HID-Ausgabereports (USB und Bluetooth inklusive CRC32)
sowie das Zerlegen der Eingabereports.
