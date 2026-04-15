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


## V7 Schritt 1 – integriert auf der V6.1-Basis

Diese Version ersetzt die bestehende H&B-Dispo nicht, sondern erweitert sie um **Fahrzeugvorgänge**.

Neu:
- Dispo-Tab **Fahrzeugvorgänge**
- neue Tabelle `vehicle_jobs`
- Serviceberater-Zuweisung
- Reinigung ja/nein, Reinigungsart, Deadline
- Statuslogik für Fahrzeugvorgänge
- Serviceberater-Liste mit eigenen Fahrzeugen
- Aufbereitungsliste für Fahrzeuge mit Reinigungsbedarf
- Status-Historie pro Fahrzeugvorgang

Bestehendes bleibt:
- Tourenplanung
- Fahrer
- Leihwagen
- Fahrbefehle
- Fahreransicht
- Rollen-/Adminlogik

Wichtig:
- Die Kopplung **Tour ↔ Fahrzeugvorgang** ist in dieser Stufe noch **nicht automatisch**.
- Diese Version ist die erste integrierte Ausbaustufe, nicht die finale V7.


## V7 Schritt 2 – Touren mit Fahrzeugvorgängen gekoppelt

Neu in dieser Stufe:
- `tours.job_id` und `tours.tour_kind`
- Tour kann mit einem Fahrzeugvorgang verknüpft werden
- Tourstatus aktualisiert den Fahrzeugstatus automatisch

Regeln:
- Abholung `geplant` → `abholung_geplant`
- Abholung `unterwegs` → `unterwegs_zu_uns`
- Abholung `erledigt` → `bei_serviceberater` (oder `eingetroffen`, wenn kein Serviceberater zugewiesen ist)
- Auslieferung `geplant` / `unterwegs` → `auslieferung_geplant`
- Auslieferung `erledigt` → `abgeschlossen`
