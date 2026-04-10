# SynFlow

SynFlow ist eine Web-App zur Disposition für Hol- & Bring-Service, Fahrer, Leihwagen und Tagesplanung.

## Enthalten in dieser Version

- Tourenplan mit 8 Touren pro Tag (4 Vormittag, 4 Nachmittag)
- Strukturierte Tourdaten für **Liefern** und **Abholen**
- Fahrerverwaltung
- Leihwagenverwaltung
- Zuweisung von Fahrer und Leihwagen pro Tour
- Rollen: Admin / Schreiben / Lesen
- Live-Updates via WebSocket
- Passwortänderung und Benutzerverwaltung
- Ottenschlag-&-Umgebung-Liste

## Standard-Login

- Benutzer: `admin`
- Passwort: `admin123`

Bitte sofort nach dem ersten Start ändern.

## Deployment mit Portainer

1. Stack anlegen
2. `docker-compose.yml` hochladen
3. `JWT_SECRET` anpassen
4. Deployen

## Datenbank

SQLite-Datei im Docker-Volume `synflow-data`.

## Nächste sinnvolle Ausbaustufen

- Wochenansicht / Kalenderansicht
- Fahrer-Verfügbarkeiten
- Serviceberater-Workflow
- Aufbereitung / Fahrzeugstatus
- Kunden- und Auftragsdatenbank
