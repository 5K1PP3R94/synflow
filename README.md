# SynFlow V6 – bereinigte Fassung

SynFlow ist eine Web-App zur Disposition für Hol- & Bring-Service, Fahrer, Leihwagen und Tagesplanung.

## Enthalten in dieser Fassung

- Tourenplan mit 8 Touren pro Tag
- getrennte Datenblöcke für **Liefern** und **Abholen**
- Fahrerverwaltung
- Leihwagenverwaltung
- Fahrbefehle mit frei sortierbaren Schritten
- Fahreransicht für mobile Nutzung
- modulbasiertes Rollensystem:
  - Dispo Hol&Bring
  - Hol & Bring Fahrer
  - Kundendienstberater
  - Fahrzeugaufbereitung
- Benutzerverwaltung mit Rechte-Stufen:
  - sehen
  - bearbeiten
  - verwalten
- Live-Updates via WebSocket
- Passwortänderung
- Ottenschlag-&-Umgebung-Liste

## Wichtige Fixes in dieser bereinigten Version

- robustere Frontend-Pfade im Backend
- Docker-Struktur passend zu `backend/` und `frontend/public/`
- sicherere Cookie-Konfiguration hinter Reverse Proxy
- Warnhinweise für Standard-Secret / Standard-Admin-Passwort
- sauberere Behandlung beim Löschen von Fahrern und Leihwagen
- aktualisierte Dokumentation passend zum echten Rollensystem

## Standard-Login beim ersten Start

- Benutzer: `admin`
- Passwort: `admin123`

Unbedingt nach dem ersten Login ändern.

## Deployment mit Docker / Portainer

1. Stack oder Build-Kontext auf den Projektordner zeigen lassen
2. `JWT_SECRET` in `docker-compose.yml` oder Portainer-Env ersetzen
3. optional `ADMIN_USERNAME` und `ADMIN_PASSWORD` setzen
4. Deployen
5. Nach dem ersten Login Passwort ändern

## Projektstruktur

```text
synflow_v6_fixed/
├── backend/
│   ├── package.json
│   └── server.js
├── frontend/
│   └── public/
│       └── index.html
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Datenbank

SQLite-Datei im Docker-Volume `synflow-data`.

## Nächste sinnvolle Ausbaustufen

- Wochenansicht / Kalenderansicht
- echte Workflows für Kundendienstberater
- echte Workflows für Fahrzeugaufbereitung
- Verfügbarkeiten / Abwesenheiten der Fahrer
- Kunden- und Auftragsdatenbank


## V7 Ausbau – Schritt 1 auf V6.1.5-Basis

Diese Version erweitert die bestehende H&B-Struktur um zentrale Fahrzeugvorgänge, ohne Tourenplanung, Fahrbefehle, Fahreransicht oder Dispo-Basis zu ersetzen.

Neu:
- Tab **Fahrzeugvorgänge** für die Dispo
- echter Bereich **Kundendienstberater**
- echte digitale **Reinigungsliste** für die Fahrzeugaufbereitung
- Fahrzeugvorgänge mit Kunde, KZ, Fahrzeug, Serviceberater, Reinigung, Deadline
- Statuswechsel zwischen Dispo, Serviceberater und Aufbereitung
- Status-Historie je Vorgang
