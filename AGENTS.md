# AGENTS.md

Anleitung für Coding-Agents und Mitwirkende. Kurz halten, bei Änderungen an Architektur oder Regeln mitpflegen.

## Projekt

Trainings-Tracker als Home-Assistant-App (Ingress). Phase 1: Krafttraining loggen, live im Gym und nachträglich, mit
selbst gepflegtem Übungskatalog. Das Datenmodell ist schon auf Planung, CrossFit und Ausdauer ausgelegt, die
Oberfläche noch nicht. Grundsatz: **KISS und YAGNI** mit Augenmaß auf spätere Phasen. Nichts bauen, was nicht
ausdrücklich gebraucht wird. Aufbau, Pipeline und viele Regeln sind von [twostone/meal-planner](https://github.com/twostone/meal-planner) übernommen.

## Layout

```
repository.yaml          HA-App-Repository
README.md, LICENSE       Installation, Entwicklung (das Repository ist öffentlich), Apache-2.0
release-please-config.json, .release-please-manifest.json   Release-Automatik (Version, Changelog)
.github/workflows/       ci.yml (Tests, Docker-Build, Smoke-Test), release.yml (Release Please, Image), lint-pr-title.yml
renovate.json            Renovate: Actions, npm, Node und Docker-Basisimage (gruppierte PRs)
sweatbook/               die App (Docker-Build-Kontext)
  config.yaml            App-Konfiguration (Version pflegt Release Please)
  translations/          de.yaml, en.yaml: Namen und Beschreibungen der Optionen
  Dockerfile             zweistufig, node:24-alpine
  src/                   Backend: Hono + node:sqlite
    db.ts                  Verbindung, Migrationen, Transaktionen
    data/                  Datenzugriff, ein Modul pro Entität (users, exercises, sessions, blocks, sets) + common
    app.ts, server.ts      API, Ingress-Sperre, Identität, Start
    log.ts, options.ts     Logger (logfmt) und App-Optionen (wie meal-planner)
  web/                   Frontend: Svelte 5 + Vite (Runes), Hash-Routen in router.svelte.ts, Zustand in store.svelte.ts
    src/logic/             reine Client-Logik ohne DOM (Schnelleingabe, Zeit, Vorbelegung, Weiter-Ziel, Format), getestet
  test/                  Tests (node:test)
```

## Befehle (in `sweatbook/`)

```
npm ci
npm test                          # alle Tests
npx tsc --noEmit                  # Typprüfung Backend und Tests
npm run check                     # svelte-check Frontend
npm run build                     # Frontend nach dist/ (wird vom Server ausgeliefert)
DB_PATH=./data/dev.db PORT=8099 npm start
npm run dev:web                   # Vite-Dev-Server, /api geht per Proxy an :8099
```

Vor jedem Commit: Tests, `tsc`, `check` und `build` müssen sauber durchlaufen (genau das prüft auch die CI).

## Datenmodell

```
app_user        HA-Nutzer -> eigene id (ha_user_id eindeutig)
exercise        Katalog pro Nutzer: name, metrics (weight_reps | duration | weight_duration), note, archived
exercise_alias  weitere Namen für die Suche
session         ein Training: title, started_at, ended_at (null = läuft), note
block           geordnet in der Session: type straight (eine Übung) | superset (A1/A2/…), params (später)
block_exercise  Übung im Block mit Reihenfolge; existiert auch ohne Sätze
set_log         Satz: weight_kg (null = Körpergewicht), reps, duration_s, is_max, note, extra (später), logged_at
```

- **Ein eingetragener Satz ist erledigt.** Ein Häkchen gibt es erst mit geplanten Sätzen (Phase 2).
- **`metrics` bestimmt die Satzfelder** (`checkSet` in `data/sets.ts`): `weight_reps` braucht `reps`, `duration` braucht
  `duration_s` ohne Gewicht, `weight_duration` braucht `duration_s`. `weight_kg` leer = Körpergewicht, ein Wert ist
  Zusatzgewicht, nie negativ (Assistenz über die Notiz). `metrics` lässt sich nur ändern, solange die Übung keine Sätze hat.
- **Namen und Aliase sind pro Nutzer eindeutig**, über Namen und Aliase hinweg, ohne Groß-/Kleinschreibung. Verglichen
  wird in JS (`nameKey` in `data/common.ts`, `toLocaleLowerCase("de")`), weil SQLites `lower()` nur ASCII kennt; die
  Unique-Indizes auf `lower(...)` sind nur ein Rückhalt. Konflikt -> 409 mit `taken_by`.
- **Übungen werden archiviert, nicht gelöscht**, sobald sie benutzt sind (`ON DELETE RESTRICT`, API 409). Archivierte
  lassen sich nicht in neue Blöcke aufnehmen (409).
- **Nur eine offene Session pro Nutzer:** Eine neue Session (oder das Wiederöffnen per `ended_at: null`) beendet die
  anderen, beim Zeitpunkt ihres letzten Satzes, ohne Sätze bei ihrem Start. Ausnahme: Eine nachgetragene Session (beim
  Anlegen mit `ended_at`) ist sofort beendet und lässt die offene laufen. Beendete Sessions bleiben voll bearbeitbar.
- **Blocktyp folgt der Anzahl der Übungen** (eine = `straight`, mehrere = `superset`). Die letzte Übung nimmt den Block mit.
- **„Letztes Mal“** (`last_time`) ist die jüngste Session mit Sätzen dieser Übung, die **vor** der Start­zeit der aktuellen
  begann (nicht die zuletzt eingetragene). So zeigt auch eine nachgetragene Session das Richtige.
- **„+ Runde“** im Supersatz (`POST /api/blocks/:id/rounds`) legt je Übung genau einen Satz an, alles oder nichts. Die
  Werte schickt der Client (in der Regel sein letzter Satz); der Server rät nichts.
- `extra` (JSON) und `block.params` sind für spätere Sportarten und Blocktypen reserviert und in Phase 1 leer.

## SQL-Regeln (portabel für einen späteren Umzug auf Postgres)

- IDs: UUIDs als `TEXT`, in der App erzeugt. Zeit: ISO-8601 in UTC, in der App erzeugt (`isoNow`), nie Datumsfunktionen
  der Datenbank. Die API nimmt Zeiten mit Offset an und speichert sie als UTC, deshalb vergleichen sie sich als Strings.
- Booleans als `INTEGER` mit `CHECK (x IN (0,1))`. Kein `COLLATE NOCASE`. JSON nur speichern, nie darin abfragen.
- Erlaubt: `CHECK`, Fremdschlüssel mit `ON DELETE`, `ON CONFLICT … DO UPDATE`, `RETURNING`.
- Einzige bewusste Ausnahme: `STRICT`-Tabellen (beim Umzug wird die DDL ohnehin neu geschrieben).
- Die Nutzertabelle heißt `app_user`: `user` ist in Postgres reserviert.
- Laufzeit-Einstellungen in `openDb`: `PRAGMA foreign_keys = ON` (sonst prüft SQLite keine Fremdschlüssel) und WAL.
- **Schema nur über Migrationen ändern:** an `MIGRATIONS` in `src/db.ts` **anhängen**, nie ändern oder umsortieren.
  Version = Position, festgehalten in `schema_migrations` (wie dbmate). Neue Migrationen mit einem Test gegen eine
  Datenbank im alten Stand.
- Rohes SQL, kein Query-Builder: Kysely kann `node:sqlite` nur über Community-Dialekte (geprüft am 24.10.2026). SQL
  bleibt in `src/data/`, ein Modul pro Entität, damit ein Wechsel eine Schicht betrifft.
- SQLite kennt keine verschachtelten `BEGIN`: Funktionen, die in einer Transaktion des Aufrufers laufen (`insertSet`),
  öffnen keine eigene.

## API

JSON unter `/api`, alle Pfade relativ zum Ingress-Präfix. Jede Anfrage braucht den Ingress-Nutzer, sonst 401. Fremde oder
unbekannte IDs ergeben 404 (nie unterscheidbar). Fehler: 400 (zod oder Regel aus den Daten), 404, 409 (Konflikt mit
Gespeichertem). Optionale Textfelder: `""` und `null` löschen, fehlt das Feld, bleibt es.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /api/me` | eigene Nutzer-ID und Anzeigename |
| `GET /api/exercises?q=` | Katalog inkl. archivierter, Suche über Namen und Aliase, zuletzt genutzte zuerst |
| `POST /api/exercises` | anlegen (`name`, `metrics`, `note`, `aliases`) |
| `GET`, `PATCH`, `DELETE /api/exercises/:id` | lesen, ändern (`aliases` ersetzt die Liste, `archived`), löschen nur unbenutzt |
| `GET /api/exercises/:id/history?before=&limit=` | Sätze nach Sessions, neueste zuerst |
| `GET /api/sessions?before=&limit=` | Liste mit `block_count`, `set_count` |
| `POST /api/sessions` | neue Session (`title`, `started_at`, `note`), beendet die offene; mit `ended_at` nachgetragen |
| `GET`, `PATCH`, `DELETE /api/sessions/:id` | ganzer Baum inkl. `last_time`; ändern (`ended_at: null` öffnet wieder) |
| `POST /api/sessions/:id/blocks` | neuer Block mit einer Übung |
| `PUT /api/sessions/:id/block-order` | Reihenfolge (alle Block-IDs genau einmal) |
| `POST /api/blocks/:id/exercises` | Übung dazu -> Supersatz |
| `POST /api/blocks/:id/rounds` | ein Satz je Übung des Blocks |
| `DELETE /api/blocks/:id`, `DELETE /api/block-exercises/:id` | Block bzw. Übung aus dem Block entfernen |
| `POST /api/block-exercises/:id/sets` | 1–20 Sätze (Schnelleingabe „3×5@100“ parst der Client) |
| `PATCH`, `DELETE /api/sets/:id` | Satz ändern, löschen |

Änderungen an Blöcken antworten mit der ganzen Session, damit der Client einfach ersetzt, was er zeigt.

## Sicherheit

- Der Server nimmt in der App nur Verbindungen von `172.30.32.2` (Supervisor-Ingress) an (`INGRESS_ONLY_IP`, im
  Dockerfile gesetzt). Ohne Verbindungsinfo wird abgelehnt (fail closed). Ohne die Sperre wären die
  `X-Remote-User-*`-Header fälschbar. Nicht lockern und nicht entfernen.
- **Identität an genau einer Stelle** (Middleware in `app.ts`): Sie macht aus dem HA-Nutzer eine `app_user`-ID. Ein
  späterer Login ohne HA (z. B. Cloudflare Access) kommt nur dort hinzu.
- **Das Repository ist öffentlich:** keine Zugangsdaten, Tokens, privaten Hostnamen oder Adressen aus dem Heimnetz
  einchecken (auch nicht in Tests, Kommentaren oder Beispielen).
- Neue Ports oder `host_network` nicht ohne Rückfrage freigeben.

## CI und Releases

Wie meal-planner (Details dort in AGENTS.md): Conventional Commits, Release Please, „Mergen des Release-PR ist der
Release“, danach in `release.yml` Tests und Image `ghcr.io/twostone/sweatbook:<version>` (amd64, arm64). Das
ghcr-Paket muss **öffentlich** sein, sonst kann Home Assistant es nicht laden. `image:` in `config.yaml` ohne Tag.
Actions nur mit vollem Commit-SHA pinnen. Voraussetzung im Repository: Einstellungen → Actions → General → „Allow GitHub
Actions to create and approve pull requests“.

## Regeln beim Ändern

- **Frontend-URLs immer relativ** (`api/sessions`), nie `/api/...`: Die App läuft unter einem wechselnden Ingress-Präfix.
- **Navigation:** Seiten über Hash-Routen (alle in `web/src/logic/routes.ts`: Start, `#/history`, `#/s/<id>`,
  `#/s/<id>/b/<id>`, `#/exercises`, `#/exercises/new`, `#/exercises/<id>`), Sheets belegen einen History-Eintrag ohne URL-Änderung
  und stehen in `history.state` (Zurück schließt sie, „Übung anlegen“ kehrt in das Sheet zurück). Geschwister (nächster
  Block) per `replace`, „nach oben“ per `goUp`, damit die Zurück-Taste nicht im Kreis läuft.
- **Funkloch:** Ungesendete Satzzeilen liegen in `localStorage` (`drafts.ts`, `storage.ts`, jeder Zugriff in try/catch),
  die zuletzt geladene Session und der Nutzer als Anzeige-Cache. Keine Warteschlange: Erneut senden macht der Nutzer.
  502–504 zählen wie fehlendes Netz (Ingress erreicht die App nicht).
- **Client-Logik** ohne DOM gehört nach `web/src/logic/` (Importe dort mit `.ts`-Endung) und bekommt Tests in
  `test/web-*.test.ts`. Typen der API spiegelt `web/src/types.ts`.
- **Design „sportlich-kräftig“**, helles und dunkles Theme folgen `prefers-color-scheme`; alle Farben als CSS-Variablen
  (`web/src/app.css`). Schriften Barlow und Barlow Condensed selbst gehostet über `@fontsource/*` (kein CDN aus dem
  Ingress-Iframe). Limettengrün im hellen Theme nur als Fläche mit dunkler Schrift, als Text das dunkle Oliv.
- **APIs und Schnittstellen vor der Nutzung gegen die aktuelle Dokumentation prüfen** (HA-App-Konfiguration, Hono,
  zod, Svelte, Vite, Node). HA nennt Add-ons inzwischen „Apps“.
- Neue Backend-Logik bekommt Tests in `test/` (`app.request(...)` mit `node:test`, Helfer in `test/helpers.ts`).
- **Logging** über `logger("modul")` aus `log.ts`, nie `console.*`. Nie ins Log: Notizen, Namen aus den
  `X-Remote-User-*`-Headern, Query-Strings.
- Neue Abhängigkeiten nur mit Grund. Erst prüfen, ob es eine etablierte Bibliothek gibt, und das Ergebnis im PR festhalten.
- Clean Code: sprechende Namen, kleine Funktionen, keine Magic Numbers, Kommentare erklären das Warum.
- UI-Texte deutsch, Code und Kommentare englisch. Bedienelemente mindestens 44 px, echte `<button>`/`<a>`.

## Stand und offene Punkte

- Phase 1 ist gebaut: Backend und Oberfläche (Start mit Nachtragen, Verlauf, Session-Übersicht, Übung, Supersatz, Sheet
  „Übung hinzufügen“, Übungskatalog mit Anlegen und Detail).
- Nachgetragene Sessions legt der Start mit `ended_at` = Beginn an (der einzige bekannte Zeitpunkt).
- Der Start erkennt die offene Session unter den neuesten (`START_SESSIONS` in `store.svelte.ts`). Eine ältere offene
  (nur per API wiedergeöffnet) zeigt er nicht. Mockups und Konzept liegen
  außerhalb des Repos.
- Am echten Home Assistant geprüft (24.10.2026): Ingress-Header `X-Remote-User-*`, Start der App, `prefers-color-scheme`
  kommt in der Companion-App an (kein eigener Theme-Umschalter nötig). Noch offen: Android-Zahlentastatur bei kg und Zeit.
- Kein `icon.png` für den App-Store (optional; aus `web/public/favicon.svg` erzeugen, wenn gewünscht).

## Git und Pull Requests

- Features über einen Pull Request (`feat/<thema>`), PR-Titel als Conventional-Commit-Zeile (deutscher Text), Squash-Merge.
- Die CI läuft auf dem PR und muss vor dem Merge grün sein. Kein Force-Push auf `main`.
