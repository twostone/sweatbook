# Sweatbook – Home-Assistant-App

<img src="sweatbook/web/static/favicon.svg" alt="Sweatbook" width="96" align="right">

[![CI](https://github.com/twostone/sweatbook/actions/workflows/ci.yml/badge.svg)](https://github.com/twostone/sweatbook/actions/workflows/ci.yml)

Eine App zum Tracken und Planen des eigenen Trainings. Sie läuft als App (früher „Add-on“) direkt in Home Assistant,
erscheint in der Seitenleiste und braucht keine eigene Anmeldung: Jeder Home-Assistant-Nutzer hat seine eigenen Daten.

**Stand:** Training loggen (live im Gym und nachträglich, mit selbst gepflegtem Übungskatalog) und Mehrwochen-Pläne
(Soll-Werte, %-vom-1RM, Testwerte, „Nächstes Workout“) sind gebaut; Pläne lassen sich aus einer JSON-Datei importieren
(`sweatbook/examples/programm-beispiel.json`) und in der App bearbeiten. Später kommen CrossFit, Zirkel und Ausdauer
(Laufen, Paddeln, Rudern) dazu.

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

## MCP-Zugriff mit Access Token

Die App kann als MCP-Server unter `/mcp` laufen, damit ein MCP-fähiger Agent (zum Beispiel Claude, Cursor oder ein eigenes
Skript) dein Training lesen und eintragen kann (alles, was die Oberfläche kann, auch Pläne). Der Agent handelt dabei in
deinem Namen. Übungen nennt er einfach beim Namen („3×5 Kniebeuge mit 100 kg eintragen“), und es gibt Auswertungen (Volumen,
Fortschritt, geschätztes 1RM) sowie die Prompts `analyze_training`, `suggest_next_workout` und `adjust_plan`. Pläne sind
außerdem als MCP-Ressourcen (`sweatbook://programs/…`) abrufbar.

1. In den App-Optionen `MCP-Server` einschalten und unter Netzwerk einen Host-Port für `8099` vergeben. Von außerhalb
   des Heimnetzes brauchst du dafür einen Tunnel oder Reverse-Proxy mit HTTPS; die App selbst spricht nur HTTP.
2. In der App über das Profil-Icon (oben rechts) einen Access Token anlegen (nur lesen oder lesen und schreiben). Er wird nur
   einmal angezeigt, lässt sich einzeln kopieren und dort jederzeit widerrufen.
3. Den Agenten verbinden: Server-Adresse `https://<adresse>/mcp` (Streamable HTTP) und der Header
   `Authorization: Bearer <access-token>`. Die Einrichtung im Profil zeigt fertige Beispiele zum Kopieren, etwa die
   JSON-Konfiguration, die die meisten Clients lesen:

```json
{ "mcpServers": { "sweatbook": { "type": "http", "url": "https://<adresse>/mcp", "headers": { "Authorization": "Bearer <access-token>" } } } }
```

Wer den Token hat, hat deinen Zugriff; behandle ihn wie ein Passwort.

## Datenschutz und Sicherheit

- Die App ist nur über Home-Assistant-Ingress erreichbar. Der Server nimmt ausschließlich Verbindungen vom Supervisor an.
  Einzige Ausnahme ist der MCP-Endpunkt `/mcp` (standardmäßig aus, siehe unten), der nur mit Access Token antwortet.
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
npm run dev:web     # Vite-Dev-Server (SvelteKit) auf :5173, /api geht per Proxy an :8099
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
