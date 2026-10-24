# Sweatbook – Home-Assistant-App

<img src="sweatbook/web/public/favicon.svg" alt="Sweatbook" width="96" align="right">

[![CI](https://github.com/twostone/sweatbook/actions/workflows/ci.yml/badge.svg)](https://github.com/twostone/sweatbook/actions/workflows/ci.yml)

Eine App zum Tracken und Planen des eigenen Trainings. Sie läuft als App (früher „Add-on“) direkt in Home Assistant,
erscheint in der Seitenleiste und braucht keine eigene Anmeldung: Jeder Home-Assistant-Nutzer hat seine eigenen Daten.

**Stand:** Phase 1 im Aufbau. Das Backend (Übungskatalog, Sessions, Blöcke und Supersätze, Sätze) steht, die Oberfläche
folgt. Später kommen Planung (Vorlagen, Programme, %-vom-1RM), CrossFit, Zirkel und Ausdauer (Laufen, Paddeln, Rudern) dazu.

## Installation

Voraussetzung: Home Assistant mit App-Store (Home Assistant OS oder Supervised), Architektur amd64 oder arm64.

1. In Home Assistant: *Einstellungen → Apps* (in älteren Versionen *Add-ons*) *→ App-Store → ⋮ → Repositories* und
   eintragen:

   ```
   https://github.com/twostone/sweatbook
   ```

2. „Sweatbook“ installieren und starten, danach „In Seitenleiste anzeigen“ aktivieren.

Home Assistant lädt dabei ein fertiges Image von `ghcr.io/twostone/sweatbook`, es wird nichts lokal gebaut. Die Daten
liegen im Datenspeicher der App (`/data`) und sind in Home-Assistant-Backups enthalten.

## Datenschutz und Sicherheit

- Die App ist nur über Home-Assistant-Ingress erreichbar. Der Server nimmt ausschließlich Verbindungen vom Supervisor an.
- Jede Anfrage gehört zu dem Home-Assistant-Nutzer, der sie stellt; andere Nutzer sehen diese Daten nicht.
- Die App ruft nichts im Internet ab.

## Entwicklung

Node 22.13 oder neuer (wegen `node:sqlite`). Alles Weitere liegt in `sweatbook/`:

```
npm ci
npm test            # Tests
npx tsc --noEmit    # Typprüfung Backend
npm run check       # Svelte-/TypeScript-Prüfung
npm run build       # Frontend nach dist/
DB_PATH=./data/dev.db PORT=8099 npm start
npm run dev:web     # Vite-Dev-Server auf :5173, /api geht per Proxy an :8099
```

Ohne Home Assistant fehlt der Nutzer-Header: API-Aufrufe brauchen dann `X-Remote-User-Id` (z. B.
`curl -H 'X-Remote-User-Id: dev' localhost:8099/api/sessions`). Der Vite-Dev-Server setzt ihn im Proxy selbst (Nutzer
`dev`), die Oberfläche läuft lokal also unter <http://localhost:5173>. Lokal ist die Ingress-Sperre aus, solange
`INGRESS_ONLY_IP` nicht gesetzt ist. Architektur, Regeln und bewusste Entscheidungen stehen in [`AGENTS.md`](AGENTS.md).

Änderungen kommen mit Conventional-Commit-Präfix (`feat:`, `fix:`, `perf:`) über Pull Requests auf `main`.
[Release Please](https://github.com/googleapis/release-please) sammelt sie in einem Release-PR; **den PR zu mergen ist
der Release.** Danach baut die CI das Image (amd64 und arm64) und veröffentlicht es als `ghcr.io/twostone/sweatbook:<version>`.

## Lizenz

[Apache License 2.0](LICENSE)
