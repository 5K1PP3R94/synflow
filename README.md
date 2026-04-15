# SynFlow V7.1 Modular

Diese Version ist bewusst in Module aufgeteilt:

- Backend: Express + SQLite + getrennte Route/DB-Module
- Frontend: ES Modules statt eine einzige HTML-Datei

## Demo-Logins

- Admin: `admin` / `admin123`
- Dispo: `dispo` / `demo123`
- Serviceberater Anna: `anna` / `demo123`
- Aufbereitung: `clean` / `demo123`

## Features in dieser Version

- zentraler Fahrzeugvorgang (`jobs`)
- Anlage durch Dispo oder Serviceberater
- Zuweisung an Serviceberater
- Reinigung ja/nein, Reinigungsart, Deadline
- Statusfluss zwischen Dispo → Service → Reinigung → Dispo
- getrennte Rollenansichten
- modularer Frontend-Aufbau

## Start lokal

```bash
npm install
npm start
```

## Docker

```bash
docker compose up -d --build
```


## Wichtige Hinweise für Deployment hinter Nginx Proxy Manager

Diese Version nutzt `better-sqlite3`. Dafür wurde das Docker-Image auf `node:20-bookworm-slim` umgestellt, weil Alpine hier oft zu Build-/Runtime-Problemen führt.

Außerdem ist `npm_default` als externes Docker-Netzwerk eingebunden, damit der Container direkt über Nginx Proxy Manager erreichbar ist, wenn du ihn per Containername proxyst.

Falls du einen alten fehlerhaften Build hast:
1. alten Stack entfernen
2. altes Image löschen
3. neu deployen mit Build ohne Cache


## Wichtiger Hinweis bei Login-Problemen

Wenn die Login-Seite geladen wird, aber keine Anmeldung funktioniert:

1. alten Stack vollständig löschen
2. altes Volume löschen (oder dieses Paket mit neuem Volume deployen)
3. neu bauen ohne Cache
4. `https://DEINE-DOMAIN/api/health` testen

Typische Ursache ist eine alte DB aus einem früheren Build oder altes Session-Cookie.


## V7.1.2 Schema-Fix

Diese Version ist toleranter gegenüber älteren oder teilweise abweichenden SQLite-Volumes.
Wenn ein Login scheinbar klappt, danach aber `HTTP 500` erscheint, lag es sehr wahrscheinlich an einem alten `jobs`- oder `users`-Schema.
Diese Version ergänzt fehlende Spalten automatisch.
