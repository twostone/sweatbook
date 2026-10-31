# AGENTS.md

Anleitung für Coding-Agents und Mitwirkende. Kurz halten, bei Änderungen an Architektur oder Regeln mitpflegen.

## Projekt

Trainings-Tracker als Home-Assistant-App (Ingress). Phase 1: Krafttraining loggen, live im Gym und nachträglich, mit
selbst gepflegtem Übungskatalog. Phase 2: Programme mit Soll-Werten, Testwerte, Training aus dem Plan. Das Datenmodell ist schon auf Planung, CrossFit und Ausdauer ausgelegt, die
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
  icon.png               Icon im App-Store (128×128 PNG, aus web/static/favicon.svg erzeugt)
  translations/          de.yaml, en.yaml: Namen und Beschreibungen der Optionen
  Dockerfile             zweistufig, node:24-alpine
  src/                   Backend: Hono + node:sqlite
    db.ts                  Verbindung, Migrationen, Transaktionen
    data/                  Datenzugriff, ein Modul pro Entität (users, exercises, sessions, blocks, sets, programs, tests, tokens) + plan (Planzeile lesen, Gewicht rechnen) + stats (Auswertungen) + log (Sätze per Übungsname eintragen) + common
    app.ts, server.ts      API, Ingress-Sperre, Identität, Start
    schemas.ts             zod-Schemas der Anfragen (von API und MCP geteilt)
    mcp.ts, mcp-http.ts    MCP-Server (Tools, Ressource, Prompts über data/*) und der Endpunkt /mcp mit Token-Prüfung
    mcp-schemas.ts        eigene Ein- und Ausgabe-Schemas der Tools (beschrieben, Übungen per Name); mcp-views.ts: kompakte Sichten und Texte
    log.ts, options.ts     Logger (logfmt) und App-Optionen (wie meal-planner)
  vite.config.ts         Vite und SvelteKit-Konfiguration (SvelteKit 3: keine svelte.config.js), adapter-static -> dist/
  web/                   Frontend: SvelteKit (Svelte 5, Runes) als reine SPA mit Hash-Router, Zustand in store.svelte.ts
    src/TopBar.svelte      Kopfzeile aller Seiten unter dem Start (Zurück, Label, Aktionen) mit ProfileLink; Start und Session haben eigene Köpfe, beide mit ProfileLink
    src/routes/            die Seiten (dünne +page.svelte, die die Views aus src/ einsetzen), +layout.svelte (Rahmen, Sheets)
    static/                favicon.svg, PWA-Manifest und Icons
    src/logic/             reine Client-Logik ohne DOM (Schnelleingabe, Zeit, Vorbelegung, Weiter-Ziel, Format), getestet
  examples/              Beispiel-Plandatei für den Import (erfundene Werte)
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
app_user        HA-Nutzer -> eigene id (ha_user_id eindeutig); sex male|female|null: welche festen Gewichte Pläne zeigen (null = Standard)
exercise        gemeinsamer Katalog aller Nutzer (user_id = angelegt von, nie gefiltert): name, Satzfelder (has_weight, has_reps, has_distance, has_duration), note, archived
exercise_alias  weitere Namen für die Suche
session         ein Training: title, started_at, ended_at (null = läuft), note
block           geordnet in der Session: type straight (eine Übung) | superset (A1/A2/…), params (später)
block_exercise  Übung im Block mit Reihenfolge und note (nur für dieses Training, z. B. der Plan); existiert auch ohne Sätze
program         Mehrwochen-Plan: Besitzer (user_id), name, shared (für alle sichtbar); start_date/archived der Tabelle werden nicht mehr gelesen
program_member  Teilnehmer eines Plans (der Besitzer immer): eigenes start_date (Montag von Woche 1) und archived
planned_session_skip  übersprungene Einheit je Nutzer (skipped_at, skip_note); die Spalten an planned_session werden nicht mehr gelesen
program_phase   Abschnitt (Mesozyklus) eines Programms: name (pro Programm eindeutig), note; die Excel nennt ihn „Block“
program_week    Woche (Mikrozyklus): number, phase_id (-> program_phase, null = ohne Abschnitt), deload (nur Anzeige)
planned_session geplante Einheit einer Woche („A“, „B“)
planned_item    Planzeile: Übung oder Hinweiszeile (ohne Übung), label (Variante), Soll als Spannen (Sätze, Wdh., Strecke, Zeit), to_max, Last fest (`load_kg`, optional `load_kg_female` nur zusammen damit) oder % einer Bezugsübung, test_kind, rest, note
exercise_test   Testwert eines Nutzers zu einer Übung (1RM oder Bestleistung), Werte wie ein Satz; set_id, wenn aus einem Trainingssatz (geht mit ihm)
api_token       Access Token für /mcp: user_id, name, token_hash (SHA-256, nie der Klartext), scope read|write, last_used_at
set_log         Satz: weight_kg (null = Körpergewicht), reps, duration_s, distance_m, is_max, note, extra (später), logged_at
```

- **Ein eingetragener Satz ist erledigt.** Ein Häkchen gibt es erst mit geplanten Sätzen (Phase 2).
- **Die Übung bestimmt die Satzfelder** (`has_weight`, `has_reps`, `has_distance`, `has_duration`; API `fields`,
  `checkSet` in `data/sets.ts`): ein Satz hat nur diese Felder, `weight_kg` darf leer bleiben (= Körpergewicht bzw. ohne
  Zusatzlast; ein Wert ist Zusatzgewicht, nie negativ, Assistenz über die Notiz), von den übrigen muss mindestens eines
  gefüllt sein. Eine Übung braucht Wdh., Strecke oder Zeit. Felder kommen jederzeit dazu, entfernen geht nur, solange
  kein Satz einen Wert darin hat (409 `field in use`). Strecke in ganzen Metern (`distance_m`).
- **Der Übungskatalog gehört allen Nutzern gemeinsam** (Migration v5 hat gleichnamige Übungen verschiedener Nutzer zusammengeführt, Satzfelder vereinigt). Archivieren, Felder und Namen gelten für alle; „zuletzt genutzt“ ist je Nutzer.
- **Namen und Aliase sind global eindeutig**, über Namen und Aliase hinweg, ohne Groß-/Kleinschreibung. Verglichen
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
- **Pläne teilen:** Der Besitzer schaltet `shared` ein; jeder andere sieht den Plan in der Liste (`joined: false`), tritt mit `POST /api/programs/:id/join` (eigenes Startdatum) bei und bearbeitet dann denselben Plan mit (Last-Write-Wins). Nur der Besitzer benennt um, teilt/entteilt und löscht (sonst 403, `ForbiddenError`). Startdatum, Archiv, übersprungen, erledigt (nur eigene Sessions) und Testwerte/1RM sind je Nutzer. Ohne Teilen oder ohne Beitritt: 404. Teilen aus sperrt die Mitglieder aus, ihre Sessions bleiben, die Mitgliedschaft lebt beim erneuten Teilen auf. Zugriffsregel an einer Stelle: `ACCESS`/`programRow` in `data/programs.ts`.
- **Gewichte für Männer und Frauen:** Eine Zeile mit fester Last kann `load_kg_female` tragen (nicht mit `load_pct`, nicht allein; 400). `weight_kg` ist für Nutzer mit `sex = female` dieses Gewicht, sonst `load_kg`; Pläne und Sessions zeigen nur `weight_kg`, der Editor kennt beide. Die Wahl trifft jeder im Profil (`PATCH /api/me`), bewusst ohne MCP-Tool (nur Ingress, wie Tokens). Import: `load: { "kg": 24, "kg_female": 16 }`.
- **Pläne rechnen, speichern nichts Geplantes:** Gewicht einer %-Zeile = jüngster 1RM der Bezugsübung bis einschließlich
  Trainingstag (für kommende Einheiten der jüngste bekannte) × Prozent, auf 2,5 kg gerundet (`plan.ts`); ohne 1RM bleibt
  `weight_kg` leer. **Erledigt** ist eine Einheit, sobald eine daran hängende Session Sätze hat (`done`), oder wenn sie
  übersprungen ist (`skipped`); „Nächstes Workout“ ist die erste offene nach Woche und Position. Eine Session aus dem
  Plan (`planned_session_id`) hat je Planzeile mit Übung einen Block (`block_exercise.planned_item_id`) und ist danach
  eine normale Session; Löschen von Plan oder Planzeile löst nur die Verweise.
- **Import** (`data/import.ts`): Übungen der Datei werden über Namen und Aliase im Katalog gefunden, fehlende mit ihren
  `fields` angelegt; `start_week` setzt frühere Einheiten auf übersprungen mit „vor der App“. Fehler nennen die Stelle
  („week 2 A, line 2: …“). Echte Plandateien enthalten Testwerte und kommen nie ins (öffentliche) Repository; dort liegt
  nur das Beispiel mit erfundenen Werten.
- **Abschnitte:** Ein Abschnitt hat nur Namen und Notiz; seine Reihenfolge folgt der Wochennummer, die Wochen eines Abschnitts müssen nicht
  zusammenhängen (die Oberfläche zeigt benachbarte Wochen als Cluster). Ein Abschnitt ohne Wochen verschwindet mit seiner letzten
  Woche (`pruneEmptyPhases`). `program_week.phase` (Text, vor Migration 5) wird nicht mehr gelesen und fällt in einer späteren Migration weg.
- **Testwerte aus dem Training:** Hat die Planzeile eines Block-Eintrags `test_kind`, hält `syncSessionTest`
  (`data/tests.ts`) nach jeder Änderung seiner Sätze einen Testwert aktuell (1RM: schwerster Satz; Bestleistung: meiste
  Wdh., dann Strecke, dann Zeit). Er steht in `planned.test` der Session; „Rückgängig“ = `DELETE /api/tests/:id`.
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
unbekannte IDs ergeben 404 (nie unterscheidbar). Fehler: 400 (zod oder Regel aus den Daten), 403 (sichtbar, aber nur für den Besitzer), 404, 409 (Konflikt mit
Gespeichertem). Optionale Textfelder: `""` und `null` löschen, fehlt das Feld, bleibt es.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /api/me` | eigene Nutzer-ID, Anzeigename und `sex` |
| `PATCH /api/me` | `sex` (`male`/`female`/`null`): welche festen Gewichte Pläne zeigen |
| `GET /api/exercises?q=` | Katalog inkl. archivierter, Suche über Namen und Aliase, zuletzt genutzte zuerst |
| `POST /api/exercises` | anlegen (`name`, `fields`, `note`, `aliases`) |
| `GET`, `PATCH`, `DELETE /api/exercises/:id` | lesen, ändern (`aliases` ersetzt die Liste, `archived`), löschen nur unbenutzt |
| `GET /api/exercises/:id/history?before=&limit=` | Sätze nach Sessions, neueste zuerst |
| `GET /api/sessions?before=&limit=` | Liste mit `block_count`, `set_count` |
| `POST /api/sessions` | neue Session (`title`, `started_at`, `note`), beendet die offene; mit `ended_at` nachgetragen |
| `GET`, `PATCH`, `DELETE /api/sessions/:id` | ganzer Baum inkl. `last_time`; ändern (`ended_at: null` öffnet wieder) |
| `POST /api/sessions/:id/blocks` | neuer Block mit einer Übung |
| `PUT /api/sessions/:id/block-order` | Reihenfolge (alle Block-IDs genau einmal) |
| `POST /api/blocks/:id/exercises` | Übung dazu -> Supersatz |
| `PATCH /api/block-exercises/:id` | Notiz der Übung in dieser Session (`note`) |
| `POST /api/blocks/:id/rounds` | ein Satz je Übung des Blocks |
| `DELETE /api/blocks/:id`, `DELETE /api/block-exercises/:id` | Block bzw. Übung aus dem Block entfernen |
| `POST /api/block-exercises/:id/sets` | 1–20 Sätze (Schnelleingabe „3×5@100“ parst der Client; nur bei Übungen mit genau einem Feld aus Wdh., Strecke, Zeit) |
| `PATCH`, `DELETE /api/sets/:id` | Satz ändern, löschen |
| `GET /api/programs` | eigene und beigetretene Programme mit `done`/`total`, `next`, `shared`, `owned`, `joined`, `owner_name`; aktive zuerst, dann geteilte ohne Beitritt |
| `POST /api/programs/:id/join`, `DELETE /api/programs/:id/membership` | geteiltem Plan beitreten (`start_date`) bzw. ihn verlassen (nicht der Besitzer) |
| `POST /api/programs/import` | ganzes Programm aus einer JSON-Datei (`file`, Format wie `examples/programm-beispiel.json`), alles oder nichts; `dry_run: true` prüft und meldet, ohne anzulegen; Antwort `program` + `new_exercises` |
| `POST /api/programs`, `GET`, `PATCH`, `DELETE /api/programs/:id` | anlegen (`name`, `start_date`); ganzer Baum mit berechneten Gewichten und Tests; `name`, `shared` (nur Besitzer), eigenes `start_date`, `archived`; löschen (nur Besitzer) |
| `POST /api/programs/:id/weeks`, `PATCH`, `DELETE /api/weeks/:id` | Woche anhängen (`phase` als Name: findet den Abschnitt oder legt ihn an, `deload`, `copy_of` kopiert eine Woche); ändern; löschen |
| `PATCH`, `DELETE /api/phases/:id` | Abschnitt umbenennen (wirkt auf alle seine Wochen, 409 bei vergebenem Namen) und `note` setzen; auflösen (die Wochen bleiben ohne Abschnitt) |
| `POST /api/weeks/:id/sessions`, `PATCH`, `DELETE /api/planned-sessions/:id` | Einheit anlegen (`label`); `label`, `skipped` (+ `skip_note`); löschen |
| `POST /api/planned-sessions/:id/items`, `PATCH`, `DELETE /api/planned-items/:id` | Planzeile (Spannen `[min, max]`; Soll nur in Feldern der Übung; `load_kg` oder `load_pct` + `load_ref_exercise_id`); ändern, löschen |
| `PUT /api/planned-sessions/:id/item-order` | Reihenfolge der Planzeilen (`item_ids`) |
| `POST /api/planned-sessions/:id/start` | Session aus der Einheit (`started_at`/`ended_at` nur zum Nachtragen) |
| `GET`, `POST /api/exercises/:id/tests`, `DELETE /api/tests/:id` | Testwerte lesen, eintragen (`kind` `one_rm`/`best`), löschen |

**MCP** (`POST /mcp`, nur mit `mcp_enabled`, sonst 404): Streamable HTTP, zustandslos (`src/mcp.ts`, Tools rufen `data/*` direkt auf).
`Authorization: Bearer sb_…` wird gegen `api_token` geprüft; das Token handelt als sein Besitzer (dieselben Regeln wie in der
UI). Ein `read`-Token bekommt nur Lese-Tools. Tokens verwaltet man über `GET/POST /api/tokens`, `DELETE /api/tokens/:id`
(nur Ingress), Klartext nur in der Antwort auf `POST`. Oberfläche: Profil (`#/profile`, Icon rechts in jedem Header) mit Name und Abschnitt "Access Token"; die Anleitung dort ist agentenneutral (Adresse, Header, JSON-Beispiel, Claude Code nur als eines).
- **Eigene Schemas für Modelle** (`mcp-schemas.ts`): jedes Eingabefeld mit Beschreibung und Einheit, **Übungen per Name, Alias oder
  ID** (`resolveExercise` in `data/exercises.ts`: nie raten, nie anlegen, Fehler nennt ähnliche Namen), Sätze mit `count`. Eingaben
  werden normalisiert und dann gegen die API-Schemas (`schemas.ts`) geprüft, damit Grenzen nur dort stehen.
- **Kompakte Ausgaben** (`mcp-views.ts`) mit `outputSchema` und `structuredContent` (+ derselbe JSON-Text): Session als Übungsliste mit
  `summary` („3×5 @ 100 kg“), Plan mit Zeilentext („3×5–8 @ 80 kg (70 % von …)“). Das SDK prüft jede Antwort gegen das Schema.
  Neue Tools brauchen immer ein Ausgabe-Schema und beschriebene Eingaben (ein Test prüft das).
- **Auswertung und Eintragen:** `get_today`, `get_exercise_progress`, `get_training_summary` (`data/stats.ts`: Volumen, Epley-1RM,
  Wochen ab Montag in der Zeitzone des Prozesses) und `log_sets` (`data/log.ts`: offene Session oder neue, Block bei Bedarf).
- **Ressourcen und Prompts:** Pläne als `sweatbook://programs/{programId}` (nur beigetretene, auch mit `read`-Token); Prompts
  `analyze_training`, `suggest_next_workout`, `adjust_plan` liefern nur Anweisungen, keine Daten.
- Neue API-Route = neues Tool in `mcp.ts` (Schreib-Tools mit `write`-Flag, Löschen zusätzlich `destructive`).

Änderungen an Blöcken antworten mit der ganzen Session, Änderungen am Plan mit dem ganzen Programm, damit der Client einfach ersetzt, was er zeigt.

## Sicherheit

- Der Server nimmt in der App nur Verbindungen von `172.30.32.2` (Supervisor-Ingress) an (`INGRESS_ONLY_IP`, im
  Dockerfile gesetzt). Ohne Verbindungsinfo wird abgelehnt (fail closed). Ohne die Sperre wären die
  `X-Remote-User-*`-Header fälschbar. Nicht lockern und nicht entfernen.
- **`/mcp` ist bewusst vom Ingress-Guard ausgenommen** (ein Pfadvergleich in `app.ts`), weil externe Clients nicht durch Ingress
  kommen. Dort zählt nur das Token: `X-Remote-User-*` wird ignoriert, falsche Token werden gedrosselt (429), die Route ist
  standardmäßig aus (`mcp_enabled`). `/api/*` bleibt unverändert Ingress-only. Die Ausnahme nicht auf andere Pfade ausweiten.
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

- **App-Icon:** `web/static/favicon.svg` ist die Quelle. `icon.png` (128×128, Dateiname von Home Assistant vorgegeben)
  ist daraus abgeleitet und wird bei jeder Änderung am SVG neu erzeugt und mit eingecheckt
  (`rsvg-convert -w 128 -h 128 web/static/favicon.svg -o icon.png`). Ein `logo.png` ist optional und bewusst nicht da.
  Genauso die PNGs in `web/static/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png` und `apple-touch-icon.png`:
  die letzten beiden aus dem SVG ohne `rx` am Hintergrund, damit sie randlos sind).
- **PWA:** `web/static/manifest.webmanifest` und die Tags in `app.html` machen die Seite installierbar, aber nur bei
  direktem Zugang. Im Ingress-iframe von Home Assistant ignoriert der Browser das Manifest, und die Ingress-URL
  funktioniert nur mit der HA-Sitzung. Bewusst kein Service Worker (Offline = `drafts.ts`, siehe Funkloch).
- **Frontend-URLs immer relativ** (`api/sessions`), nie `/api/...`: Die App läuft unter einem wechselnden Ingress-Präfix.
- **SvelteKit:** reine SPA, `router.type: "hash"` (Seiten-Optionen wie `ssr` sind dort wirkungslos), `adapter-static` mit
  `fallback: "index.html"` nach `dist/`. Der Adapter schreibt dort absolute Pfade (`/_app/…`); `relativeFallback` in
  `vite.config.ts` macht sie relativ, sonst läuft die App unter dem Ingress-Präfix nicht. Mit dem Hash-Router steckt die
  Query im Hash: `page.url.hash`, gelesen mit `hashQuery` (`logic/routes.ts`), nicht `page.url.searchParams`. Die Warnung
  `tsconfig_extends_missing` beim Build betrifft das Backend-`tsconfig.json` und ist gewollt (`web/tsconfig.json` erweitert
  `$app/tsconfig`). Kein `$lib` (in SvelteKit 3 entfernt), die Views liegen direkt in `web/src/`.
- **Navigation:** Seiten über Hash-Routen (Dateien unter `web/src/routes/`, die Pfade dazu in `web/src/logic/routes.ts`: Start, `#/history`, `#/s/<id>`,
  `#/s/<id>/b/<id>`, `#/exercises`, `#/exercises/new`, `#/exercises/<id>`, `#/profile`, `#/programs`, `#/programs/import`, `#/programs/<id>`, `#/programs/<id>/s/<einheit>`), Sheets belegen einen History-Eintrag ohne URL-Änderung
  und stehen in `page.state.sheet` (Shallow Routing über `goto(…, { shallow: true, state, persistState: true })`, nie
  `history.pushState` direkt, das gehört SvelteKit; Zurück schließt sie, „Übung anlegen“ kehrt in das Sheet zurück). Geschwister (nächster
  Block) per `replace`, „nach oben“ per `goUp`, damit die Zurück-Taste nicht im Kreis läuft.
- **Training aus dem Plan (Client):** Die Übungsseite zeigt `planned` als „Soll“-Kachel und belegt die nächste Satzzeile
  aus dem Plan vor (Gewicht, obere Grenze je Soll; was der Plan offen lässt, folgt der alten Regel in `prefill.ts`),
  solange geplante Sätze übrig sind. Ein Satz auf einer Test-Planzeile erzeugt einen Testwert auf dem Server; der Store
  holt danach nur `planned` der Übung nach (`refreshTest`), damit „Neuer Testwert · Rückgängig“ stimmt.
- **Plan bearbeiten (Client):** `ProgramView` zeigt ab 900 px Breite ein Raster (eine Spalte je Woche, nach Abschnitt in Cluster gruppiert, die umbrechen statt zu scrollen; `groupWeeksByPhase`; die Überschrift öffnet den Abschnitt im Editor, der Pfeil klappt ihn ein, nicht gespeichert, beim Laden alles offen; „Abschnitt“ am Rasterende legt über `new-phase` einen Abschnitt mit leerer Woche an, nur am Desktop) mit Seitenleiste
  (`PlanEditor`), darunter die Wochenliste. Auf dem Handy bearbeitet man Zeilen und Einheiten aus `PlannedView` über ein
  Sheet (`plan-edit` in `SheetState`, der Editor hält nur IDs). Jede Änderung antwortet mit dem ganzen Programm und ersetzt
  den Zustand; Formular ↔ API-Body und Spannen (`„5–8“`) stehen in `logic/plan-edit.ts` und `logic/range.ts`. Kein Offline-Entwurf für den Plan.
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
- Phase 2 ist gebaut: Satzfelder pro Übung, Programme mit Wochen, Einheiten und Planzeilen, Testwerte, Import aus JSON,
  Training aus dem Plan (Start-Karten, geplante Einheit, Soll und Vorbelegung, Testwert aus dem Testsatz) und der Editor.
  Die Übungsseite hat bewusst eine nachgefüllte „nächster Satz“-Zeile statt mehrerer vorbelegter. Konzept und Entscheidungen
  liegen außerhalb des Repos.
- Nachgetragene Sessions legt der Start mit `ended_at` = Beginn an (der einzige bekannte Zeitpunkt).
- Der Start erkennt die offene Session unter den neuesten (`START_SESSIONS` in `store.svelte.ts`). Eine ältere offene
  (nur per API wiedergeöffnet) zeigt er nicht. Mockups und Konzept liegen
  außerhalb des Repos.
- Am echten Home Assistant geprüft (24.10.2026): Ingress-Header `X-Remote-User-*`, Start der App, `prefers-color-scheme`
  kommt in der Companion-App an (kein eigener Theme-Umschalter nötig). Noch offen am echten Gerät: Android-Zahlentastatur bei kg und Zeit, Dateiauswahl für den Plan-Import in der
  Companion-App, vier Satzfelder in einer Zeile.

## Git und Pull Requests

- Features über einen Pull Request (`feat/<thema>`), PR-Titel als Conventional-Commit-Zeile (deutscher Text), Squash-Merge.
- Die CI läuft auf dem PR und muss vor dem Merge grün sein. Kein Force-Push auf `main`.
