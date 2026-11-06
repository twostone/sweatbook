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
   https://github.com/twostone/hassio-apps
   ```

   Das ist das gemeinsame Repository aller twostone-Apps; es wird nach jedem Release automatisch aktualisiert.

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

## MCP-Zugriff mit Anmeldung über Home Assistant (OAuth)

Clients, die OAuth beherrschen (etwa ein Connector in Claude oder Claude Code), brauchen keinen Access Token. Du gibst nur
die Adresse ein und meldest dich bei Home Assistant an. Home Assistant stellt die Tokens aus, die App prüft sie nur. Unter
`/.well-known/oauth-protected-resource` nennt sie den Clients Home Assistant als Anmeldestelle (RFC 9728). Voraussetzung ist
**Home Assistant 2026.10.1 oder neuer** (PKCE, Client-ID-Metadaten-Dokumente und Loopback-Weiterleitungen).

1. `MCP-Server` einschalten, einen Host-Port für `8099` vergeben und einen Reverse-Proxy mit HTTPS davorsetzen.
2. In den App-Optionen `Externe Adresse der App` auf diese HTTPS-Adresse setzen (z. B. `https://sweatbook.example.com`).
3. Die Adresse von Home Assistant übernimmt die App beim Start aus *Einstellungen → System → Netzwerk* (externe URL). Ist
   dort nichts eingetragen (z. B. nur Home Assistant Cloud), setzt du `Externe Adresse von Home Assistant` selbst. Home
   Assistant muss unter dieser Adresse aus dem Browser erreichbar sein. Eine Änderung wirkt erst nach einem Neustart der App.
4. Im Client `https://<adresse>/mcp` eintragen und der Anmeldung bei Home Assistant zustimmen. Das Profil in der App zeigt die
   fertige Adresse.

Fehlt eine der beiden Adressen, bleibt OAuth aus (Hinweis im Protokoll), und `/mcp` arbeitet wie bisher nur mit Access Token.

**Wichtig: Die Zielgruppe (Audience) der Tokens wird nicht geprüft.** Home-Assistant-Tokens haben keine Audience. Die App
nimmt deshalb **jedes** gültige Token eines echten Home-Assistant-Benutzers an, auch Long-Lived Access Tokens, und handelt
mit voller Berechtigung (lesen und schreiben) als dieser Benutzer. Umgekehrt hält ein Client nach der Anmeldung ein Token,
das in deinem ganzen Home Assistant gilt, nicht nur in Sweatbook. Melde dich nur bei Clients an, denen du vertraust. Für einen
Zugriff, der nur lesen darf, nimm einen Access Token. System-Benutzer (z. B. andere Apps) werden abgelehnt.

## Datenschutz und Sicherheit

- Die App ist nur über Home-Assistant-Ingress erreichbar. Der Server nimmt ausschließlich Verbindungen vom Supervisor an.
  Einzige Ausnahme ist der MCP-Endpunkt `/mcp` (standardmäßig aus, siehe oben), der nur mit Access Token oder einem Token von
  Home Assistant antwortet, und mit OAuth die öffentlichen Metadaten unter `/.well-known/oauth-protected-resource`.
- Die App darf die Core-API von Home Assistant ansprechen (`homeassistant_api`), nutzt das aber nur, um beim Start die
  externe URL zu lesen.
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
