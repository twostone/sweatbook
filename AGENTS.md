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
    data/                  Datenzugriff, ein Modul pro Entität (users, exercises, sessions, blocks, sets, programs, tests) + plan (Planzeile lesen, Gewicht rechnen) + common
    app.ts, server.ts      API, Ingress-Sperre, Identität, Start
    log.ts, options.ts     Logger (logfmt) und App-Optionen (wie meal-planner)
  vite.config.ts         Vite und SvelteKit-Konfiguration (SvelteKit 3: keine svelte.config.js), adapter-static -> dist/
  web/                   Frontend: SvelteKit (Svelte 5, Runes) als reine SPA mit Hash-Router, Zustand in store.svelte.ts
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
app_user        HA-Nutzer -> eigene id (ha_user_id eindeutig)
exercise        Katalog pro Nutzer: name, Satzfelder (has_weight, has_reps, has_distance, has_duration), note, archived
exercise_alias  weitere Namen für die Suche
session         ein Training: title, started_at, ended_at (null = läuft), note
block           geordnet in der Session: type straight (eine Übung) | superset (A1/A2/…), params (später)
block_exercise  Übung im Block mit Reihenfolge und note (nur für dieses Training, z. B. der Plan); existiert auch ohne Sätze
program         Mehrwochen-Plan eines Nutzers: name, start_date (Montag von Woche 1), archived
program_phase   Abschnitt (Mesozyklus) eines Programms: name (pro Programm eindeutig), note; die Excel nennt ihn „Block“
program_week    Woche (Mikrozyklus): number, phase_id (-> program_phase, null = ohne Abschnitt), deload (nur Anzeige)
planned_session geplante Einheit einer Woche („A“, „B“): skipped_at, skip_note
planned_item    Planzeile: Übung oder Hinweiszeile (ohne Übung), label (Variante), Soll als Spannen (Sätze, Wdh., Strecke, Zeit), to_max, Last fest oder % einer Bezugsübung, test_kind, rest, note
exercise_test   Testwert einer Übung (1RM oder Bestleistung), Werte wie ein Satz; set_id, wenn aus einem Trainingssatz (geht mit ihm)
set_log         Satz: weight_kg (null = Körpergewicht), reps, duration_s, distance_m, is_max, note, extra (später), logged_at
```

- **Ein eingetragener Satz ist erledigt.** Ein Häkchen gibt es erst mit geplanten Sätzen (Phase 2).
- **Die Übung bestimmt die Satzfelder** (`has_weight`, `has_reps`, `has_distance`, `has_duration`; API `fields`,
  `checkSet` in `data/sets.ts`): ein Satz hat nur diese Felder, `weight_kg` darf leer bleiben (= Körpergewicht bzw. ohne
  Zusatzlast; ein Wert ist Zusatzgewicht, nie negativ, Assistenz über die Notiz), von den übrigen muss mindestens eines
  gefüllt sein. Eine Übung braucht Wdh., Strecke oder Zeit. Felder kommen jederzeit dazu, entfernen geht nur, solange
  kein Satz einen Wert darin hat (409 `field in use`). Strecke in ganzen Metern (`distance_m`).
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
unbekannte IDs ergeben 404 (nie unterscheidbar). Fehler: 400 (zod oder Regel aus den Daten), 404, 409 (Konflikt mit
Gespeichertem). Optionale Textfelder: `""` und `null` löschen, fehlt das Feld, bleibt es.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /api/me` | eigene Nutzer-ID und Anzeigename |
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
| `GET /api/programs` | Programme mit `done`/`total` und `next` (nächste Einheit); aktive zuerst |
| `POST /api/programs/import` | ganzes Programm aus einer JSON-Datei (`file`, Format wie `examples/programm-beispiel.json`), alles oder nichts; `dry_run: true` prüft und meldet, ohne anzulegen; Antwort `program` + `new_exercises` |
| `POST /api/programs`, `GET`, `PATCH`, `DELETE /api/programs/:id` | anlegen (`name`, `start_date`); ganzer Baum mit berechneten Gewichten und Tests; Name, Start, `archived`; löschen |
| `POST /api/programs/:id/weeks`, `PATCH`, `DELETE /api/weeks/:id` | Woche anhängen (`phase` als Name: findet den Abschnitt oder legt ihn an, `deload`, `copy_of` kopiert eine Woche); ändern; löschen |
| `PATCH`, `DELETE /api/phases/:id` | Abschnitt umbenennen (wirkt auf alle seine Wochen, 409 bei vergebenem Namen) und `note` setzen; auflösen (die Wochen bleiben ohne Abschnitt) |
| `POST /api/weeks/:id/sessions`, `PATCH`, `DELETE /api/planned-sessions/:id` | Einheit anlegen (`label`); `label`, `skipped` (+ `skip_note`); löschen |
| `POST /api/planned-sessions/:id/items`, `PATCH`, `DELETE /api/planned-items/:id` | Planzeile (Spannen `[min, max]`; Soll nur in Feldern der Übung; `load_kg` oder `load_pct` + `load_ref_exercise_id`); ändern, löschen |
| `PUT /api/planned-sessions/:id/item-order` | Reihenfolge der Planzeilen (`item_ids`) |
| `POST /api/planned-sessions/:id/start` | Session aus der Einheit (`started_at`/`ended_at` nur zum Nachtragen) |
| `GET`, `POST /api/exercises/:id/tests`, `DELETE /api/tests/:id` | Testwerte lesen, eintragen (`kind` `one_rm`/`best`), löschen |

Änderungen an Blöcken antworten mit der ganzen Session, Änderungen am Plan mit dem ganzen Programm, damit der Client einfach ersetzt, was er zeigt.

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
  `#/s/<id>/b/<id>`, `#/exercises`, `#/exercises/new`, `#/exercises/<id>`, `#/programs`, `#/programs/import`, `#/programs/<id>`, `#/programs/<id>/s/<einheit>`), Sheets belegen einen History-Eintrag ohne URL-Änderung
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
