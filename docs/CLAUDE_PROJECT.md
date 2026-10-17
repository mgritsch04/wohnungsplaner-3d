# Umzug in ein Claude-Code-Projekt (Projects, Beta)

Stand: 2026-10-16. Diese Datei beschreibt, wie das Projekt in ein Claude-Code-Projekt (Seitenleiste „Projects“ auf claude.ai/code bzw. im Code-Tab der Desktop-App) eingerichtet wird, und enthält den Text für die Projektanweisungen.

## 1. Projekt anlegen (du)

1. Seitenleiste **Projects → Neues Projekt**, Name z. B. „Wohnungsplaner 3D“.
2. **Repository** `mgritsch04/wohnungsplaner-3d` hinzufügen (die Claude-GitHub-App muss auf dem Repository installiert sein).
3. **Environment:**
   - Setup-Script: `npm ci`
   - Netzwerk: wie bisher (npm muss erreichbar sein). Playwright-Chromium ist in der Cloud vorinstalliert (`PLAYWRIGHT_BROWSERS_PATH`), es muss nichts heruntergeladen werden.
   - Keine Secrets nötig.
4. **Projektanweisungen:** den Text aus Abschnitt 2 einfügen (unter 16.000 Zeichen).
5. Optional **Routinen** (Abschnitt 4).

`CLAUDE.md`, `docs/` und `.claude/` kommen automatisch aus dem Repository mit; lokale Einstellungen deines PCs nicht.

## 2. Text für die Projektanweisungen (zum Einfügen)

```
Projekt: Wohnungsplaner 3D (Repository mgritsch04/wohnungsplaner-3d) – Browser-App zum Planen einer Wohnung in 2D/3D (React 19, TypeScript, Vite, three/R3F, zustand, zod, vitest, Playwright).

Sprache: Mit mir immer Deutsch sprechen. Kurz und klar, ohne Fachjargon, wenn es nicht nötig ist.

Zu Beginn jedes Threads: CLAUDE.md, docs/PROJECT_STATUS.md, docs/IDEAS.md und docs/DEVELOPMENT_WORKFLOW.md lesen. PROJECT_STATUS.md nach jedem Meilenstein aktualisieren.

Arbeitsablauf (Details in docs/DEVELOPMENT_WORKFLOW.md):
1. Zuerst GitHub-Issues prüfen: Antworten auf [USERTEST]-Issues (BESTANDEN → schließen, Label done; FEHLGESCHLAGEN → Label needs-fix + priority: high, Korrektur einplanen), neue idea-inbox-Issues sichten und in docs/IDEAS.md aufnehmen (Label planned), offene user-task-Issues.
2. Dann fehlgeschlagene Tests korrigieren, danach priority: high, danach die oberste unblockierte Ready-Zeile in docs/IDEAS.md.
3. Arbeit in kleinen, fokussierten Commits mit Präfix (feat:, fix:, test:, perf:, docs:). Vor jedem Commit: npx tsc -b, npm run lint, npm test, npm run build; vor einem PR die volle E2E-Suite (npx playwright test).
4. Mehrere Features als Sammel-PR nach main; mergen erst bei grüner CI. Nach dem Merge: in den zugehörigen [USERTEST]-Issues „Jetzt in main“ kommentieren, Feature-Issues schließen, Dashboard und Doku aktualisieren.
5. Für jedes fertige Feature ein [USERTEST]-Issue mit nummerierten Schritten anlegen. Nie einen Test als bestanden markieren, den ich nicht selbst bestätigt habe. Visuelle Änderungen nur als geprüft melden, wenn du sie tatsächlich angesehen hast (Screenshot).

Parallele Arbeit: Opus-Agents in eigenen Git-Worktrees (eigener Branch, eigener E2E-Port PW_PORT), Ergebnisse in einen Integrations-Branch zusammenführen; e2e/app.spec.ts-Konflikte sind meist nur Anhänge (beide Seiten behalten, angepasste Bestandstests per Drei-Wege-Abgleich übernehmen). Keine Git-Konflikte riskieren: Agents klare „nicht anfassen“-Listen geben.

Nutzungslimit steuern: Ziel ca. 90 % des 5-Stunden-Fensters bis zum Reset, nicht 100 %. Erlaubtes Tempo = (90 % − aktueller Stand) ÷ Stunden bis Reset. Liegt das gemessene Tempo darüber, keine neuen Agents starten (laufende fertig werden lassen); deutlich darunter (< 70 % des erlaubten) → einen weiteren Agent starten; in der letzten Stunde vor dem Reset darf der Rest genutzt werden. Wochenlimit mitprüfen (ab ~80 % Hochrechnung bremsen). Kurz vor dem Limit einen Weckruf auf den Reset stellen, damit es danach weitergeht. Nie zusätzliche kostenpflichtige Nutzung aktivieren.

Dashboard: Gesamtansicht https://claude.ai/artifact/DLsyumhy4w8L66F1VNA9pk (gemeinsam mit dem Fitness-Projekt). Jeder Thread trägt seine Zeile bei Start, Schrittwechsel und Ende in die Zulieferung https://claude.ai/artifact/8a3jqSF73Stryn2zuhA5FJ ein (Artefakt-Datenbank: collection `board`, Dokument `live`, nur die eigene Zeile in `rows` ersetzen, immer mit `if_version`). Das alte Dashboard (Smc3…) ist gelöscht.

App als Artefakt: https://claude.ai/artifact/V1VLy26ytDs9YkHVUvv6MW – nach jedem Merge nach main mit npm run build:artifact bauen und mit dem Manifest (artifact-manifest.json) neu veröffentlichen. Der normale Build (npm run build / dist) darf sich dadurch nie ändern.

Regeln (immer):
- Nie force-pushen, keine Branch-Schutzregeln oder Pflicht-Checks umgehen, keine fremde uncommittete Arbeit überschreiben, nichts Ungemergtes löschen, keine Sicherheits- oder Rechte-Einstellungen ändern.
- Erfolg (Tests, Commits, Pushes, Merges, Issue-Änderungen) nur melden, wenn er tatsächlich geprüft ist.
- Keine Secrets oder Zugangsdaten im Code; keine Home-Assistant-Zugangsdaten im Browser-Code.
- Kein Scraping, kein Umgehen von Bot-Schutz oder Rate-Limits; keine erfundenen Produktdaten, Maße, Preise, Endpunkte oder Assets.
- Händler-Integrationen nur in src/catalog/providers; Geometrie-Kern bleibt eine Quelle der Wahrheit (src/model, derivePlan()).
- Persönliche Dateien von mir (z. B. Grundrisse) nie ins Repository committen; für Tests synthetische Nachbauten verwenden.
- Keine Endlosschleifen, keine automatischen Läufe ohne festes Ende; Automatisierungen nur mit meiner Zustimmung.
```

## 3. Übergabe (Stand 2026-10-16, ca. 19:45 UTC)

- **main** enthält alles bis PR #141 (Symbolleiste, Möbelgruppen, Sichtlinien, Maßband, kurze Maßlinien, 2D-Plan, Artefakt-Build).
- **In Arbeit:** Korrektur-Paket aus fehlgeschlagenen User-Tests (#47 Ducken umschalten, #107 E öffnet Türen beim Begehen, #94 Maßlinien bei Mehrfachauswahl, #16 Kollisions-Rückmeldungen, #133 Messlinie im neuen Projekt) – Branch `claude/usertest-fixes` (Opus-Agent der bisherigen Sitzung).
- **Als Nächstes:** #114 Grundriss-Import mit dem Plan des Nutzers (liegt nur lokal vor; für Tests synthetisch nachbauen: AutoCAD-PDF A3 1:75 mit farbig gefüllten Räumen, dunkelgrau gefüllten Wänden, Nebenplänen; zusätzlich gescannte Fassung – schief, verrauscht, ohne Papiergröße); #12 IKEA-Produktlisten-Import (Kallax fehlt, Teil B des Tests verständlicher beschreiben); #134 Smart-Home-Gesamtkonzept (priority: high); UI-Runde #122 (wartet auf Stichworte des Nutzers) inkl. Lesbarkeit im Artefakt und Handy-Ansicht.
- **Offene User-Tests:** siehe Label `user-test` (Dashboard „Zum Testen“).
- **Dashboard-Updater:** Haiku-Cloud-Session „Dashboard-Updater“, endet spätestens 2026-10-17 00:00 UTC. Hinweise: geplante Routinen-Sessions hatten die nötigen claude-code-remote-Lesewerkzeuge nicht; Updater-Läufe brauchen die ausdrückliche Freigabe des Nutzers in ihrer eigenen Session (Auto-Modus), und pro Lauf sollte ein Wegwerf-Hilfsagent die großen Daten holen.
- **Lokale Sitzung „Hallo“** (Windows-PC des Nutzers) ist beendet; Kanal-Issue #110 wird nicht mehr gelesen.

## 4. Routinen (Vorschlag, nur mit Zustimmung)

- **Täglicher Lauf** (z. B. 05:50 Wien): Issues prüfen, eine Ready-Aufgabe umsetzen, PR öffnen; nie direkt nach main. Prompt-Vorlage: `docs/ROUTINE_PROMPT.md`.
- **Dashboard-Updater** als Routine im Projekt: vorher prüfen, ob Routinen-Sessions im Projekt die claude-code-remote-Werkzeuge (list_sessions, list_events) haben; sonst bleibt es bei einer manuell gestarteten Haiku-Session mit Ende-Zeit.
