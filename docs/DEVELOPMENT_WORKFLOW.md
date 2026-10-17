# Entwicklungs-Workflow

_Stand 2026-10-17 – beschreibt, was in diesem Repository und dieser Umgebung tatsächlich gilt._

## Repository
- GitHub: `mgritsch04/wohnungsplaner-3d` (**öffentlich** seit 2026-10-17), Standard-Branch `main`.
- `main` hat laut GitHub-API keine Branch-Schutzregel (geprüft 2026-10-17); trotzdem gilt: nie direkt auf `main` pushen, Integration nur per PR bei grüner CI.
- CI: `.github/workflows/ci.yml` mit den Jobs `checks` (Lint, Typprüfung, Unit-Tests, Build) und `e2e` (Playwright). Läuft auf Pushes nach `main` und auf Pull Requests.
- Labels anlegen bzw. Farben angleichen: `scripts/setup-labels.sh` (braucht die GitHub-CLI `gh`, idempotent).

## Branches
- Jeder Thread arbeitet auf seinem eigenen, sitzungsgebundenen Branch `claude/…` (Name kommt aus der Umgebung). Mehrere Branches parallel sind normal; jeder Thread fasst nur seine eigenen Dateien an.
- Integration nach `main` per **Pull Request mit Merge-Commit**, sobald der Stand lokal geprüft ist (Lint, `tsc -b`, `npm test`, `npm run build`, `npx playwright test`) und die GitHub-CI des PR grün ist. Der Nutzer hat autonome Integration getesteter Stände erlaubt.
- Nach dem Merge den eigenen Branch auf das neue `main` setzen (er enthält dann nur gemergte Historie); nie fremde Branches umschreiben.

## Commits
- Klein und thematisch: `feat:`, `fix:`, `test:`, `perf:`, `docs:`, `ci:`.
- Vor jedem Commit mindestens die betroffenen Checks; vor Integration alle.
- Nach jedem Commit `git push` und Prüfung (`git status -sb` = synchron).

## Verboten
- Force-Push, History-Rewrite, Löschen ungemergter Branches, Umgehen von Schutzregeln oder Checks, Ändern von Sicherheitseinstellungen, Committen von Secrets/Build-Artefakten.

## Lokale Befehle
```
npm ci                # Abhängigkeiten
npm run dev           # Entwicklung
npm run lint && npx tsc -b && npm test && npm run build
npx playwright test   # E2E (startet vite preview; laufenden alten preview auf :4173 vorher beenden)
```

## Ideen, Aufgaben und Abnahme über GitHub-Issues

**Rollen**
- **Ideen-Thread (mobil, Ideenerfassung):** legt ausschließlich GitHub-Issues mit Label `idea-inbox` an oder ergänzt offene `idea-inbox`-Issues per Kommentar. Ändert **keine** Projektdateien, keine Labels anderer Issues, keine PRs. Anleitung: [`IDEA_CAPTURE.md`](IDEA_CAPTURE.md).
- **Haupt-Thread:** einzige Stelle, die `docs/IDEAS.md` und `docs/PROJECT_STATUS.md` pflegt; übernimmt Ideen, sortiert Issues ein, plant Aufgaben.
- **Feature-Threads:** setzen je eine Aufgabe um, testen, öffnen und mergen ihre PR, schreiben danach Testschritte und Label in ihr Issue (Schritt 6) und melden dem Haupt-Thread, was in Backlog und Status nachzuziehen ist. Höchstens 3 Feature-Threads gleichzeitig je Projekt.
- **Test-Thread:** führt die automatischen User-Tests aus (siehe „Automatische User-Tests“) und pflegt `scripts/usertest`.
- **Koordination und Leiter:** Die Koordination des Projekts startet die Threads und entscheidet die Reihenfolge; das Projekt „Leiter“ ist dein Ansprechpartner für alle Projekte, sagt das Usage-Budget an und vermittelt zwischen den Projekten.
- **Du (Nutzer):** Ideen erfassen, User-Tests durchführen, wenn ein Issue das Label `user-test` trägt, und im selben Issue mit `BESTANDEN` bzw. `FEHLGESCHLAGEN: …` antworten (eindeutige Tests erledigt vorher die automatische Prüfung, siehe unten), Entscheidungen treffen.

**Labels (Status; je Issue genau eines)**
| Label | Bedeutung |
|---|---|
| `idea-inbox` | neue Idee, noch nicht übernommen |
| `planned` | geprüft und in `docs/IDEAS.md` aufgenommen (Ready/Blocked/Inbox dort) |
| `in-progress` | wird umgesetzt |
| `auto-user-test` | in `main`, Testschritte stehen als Kommentar im Issue; die automatische Prüfung ist dran |
| `user-test` | manuelle Prüfung durch dich offen, im Feature-Issue |
| `needs-fix` | dein User-Test ist fehlgeschlagen (Issue bleibt offen) |
| `done` | vollständig abgeschlossen (mit User-Test: von dir oder eindeutig automatisch bestanden) |
| `user-task` | `[AUFGABE]`-Issue: der Haupt-Thread braucht etwas von dir (Freigabe, Entscheidung, Datei, Netzfreigabe) |

Zusatzlabels (neben dem Status): `priority: high` (Blocker und dringende Punkte, vor neuen Ideen bearbeiten), `info` (erledigt, enthält aber eine wichtige Info für dich – du schließt es), `blocked` (von der Ideen-Session vergeben, wenn etwas offensichtlich blockiert ist).

**Prioritäten beim Start und zwischen Aufgaben (#34, #35, #40)**
1. Ein ausdrücklicher Auftrag von dir im Chat geht immer vor.
2. **Fehlgeschlagene User-Tests** (`FEHLGESCHLAGEN` in einem Issue mit `user-test`, Label `needs-fix`) – vorhandene Funktionen reparieren und abschließen. Vorher prüfen, ob der getestete Stand schon in `main` war; wenn nicht, im Issue darauf hinweisen und nach dem Merge neu testen lassen (kein Fehlschlag).
3. **Issues mit `priority: high`**, die Aufgaben für Claude Code sind – vor neuen Ideen und vor `Ready`-Aufgaben.
4. **Deine Kommentare** in offenen Issues (Antworten auf `user-task`, Rückfragen) zeitnah verarbeiten.
5. Neue `idea-inbox`-Issues übernehmen, dann die oberste `Ready`-Zeile in `docs/IDEAS.md`.

**Issue-Pflege (#35, #36)**
- Feature-artige Arbeit (neue Funktion, Fehlerbehebung, sichtbare Änderung) bekommt **sofort ein Issue**, bevor sie beginnt – auch wenn der Auftrag im Chat kam. Daran hängen später Testschritte und Abnahme.
- Issue-Check **zu Sitzungsbeginn, nach jeder abgeschlossenen Aufgabe** (nach Commit/PR) **und spätestens alle 30–60 Minuten**: neue/geänderte Issues seit dem letzten Check lesen. Einen dauerhaft im Hintergrund laufenden Prüfer gibt es innerhalb einer Sitzung nicht (kein Pollen); zwischen Sitzungen übernimmt das die Routine (#30). Für das Auflisten/Zusammenfassen dürfen Hilfsagenten mit kleinem Modell eingesetzt werden (siehe „Modellwahl“).
- **Fertige Aufgaben werden geschlossen** (Label `done`), sobald der Stand in `main` ist und kein Test mehr offen ist (siehe Schritt 6) – nicht nur kommentiert. Steht noch eine wichtige Info für dich drin, bekommt das Issue zusätzlich das Label **`info`** und bleibt offen; du schließt es selbst oder per Kommentar. Wirklich offene Aufgaben bleiben offen.
- `user-task`-Issues werden geschlossen, sobald deine Antwort umgesetzt bzw. in `docs/IDEAS.md` eingeplant ist.

**Hilfsagent für Issue-Pflege (auf deinen Wunsch)**
- Der Haupt-Thread startet zu Sitzungsbeginn und nach jeder abgeschlossenen Aufgabe einen Hilfsagenten mit kleinem Modell (Haiku) im Hintergrund. Er **liest** alle offenen Issues und bereitet eine **Arbeitsliste** für den Haupt-Thread vor: Reihenfolge nach den Prioritäten oben (fehlgeschlagene Tests → `priority: high`, vor allem deine `idea-inbox`-High-Prio-Issues → Kommentare → Ideen), je Issue empfohlene Aktion, Entwurf für die `IDEAS.md`-Zeile (Beschreibung, Nutzen, Priorität, Abhängigkeiten, Abnahme) und Label-Auffälligkeiten.
- Er darf nur eindeutige Label-Korrekturen vornehmen und kurze Hinweis-Kommentare schreiben; er ändert **keine Dateien, kein Git, schließt keine Issues** und fasst `user-test`/`user-task`-Entscheidungen nicht an – so entstehen keine Konflikte mit dem Haupt-Thread. Entscheiden, umsetzen und `docs/IDEAS.md` pflegen bleibt beim Haupt-Thread, der die Arbeitsliste direkt übernimmt.

**`docs/IDEAS.md` und Branches (#40)**
- Direkte Pushes auf `main` sind tabu (Schutzregel). Deshalb wird `docs/IDEAS.md` auf dem Arbeits-Branch gepflegt und **zügig per PR in `main` integriert**; der Stand in `main` ist maßgeblich. Bearbeitest du die Datei selbst (z. B. im GitHub-Web), bitte auf `main` oder auf dem Arbeits-Branch – der Haupt-Thread holt die Änderung vor dem eigenen Bearbeiten per Merge/Fast-Forward und überschreibt sie nie.
- Mehrere Branches sind erlaubt, wenn sinnvoll (z. B. ein reiner Doku-PR parallel zu einer Feature-Arbeit), immer `claude/…`-Präfix, jeder über PR mit grüner CI. Bei parallelen Änderungen an `docs/IDEAS.md` auf verschiedenen Branches Konflikte vor dem Merge auflösen, nie per Force-Push.

**Kontingent (#13):** Nur das Kontingent deines Pro-Plans. Kein Thread kauft etwas, aktiviert keine „usage credits“ oder Zusatznutzung und ändert keine Abrechnungseinstellungen (kann sie auch nicht). Ist das Kontingent erschöpft, stoppt die laufende Sitzung; sie kann sich **nicht** selbst nach dem Zurücksetzen neu starten. Fortgesetzt wird durch deine Nachricht („weiter“) oder den nächsten planmäßigen Routine-Lauf (#30). Ein abgelehnter Routine-Lauf wird nicht nachgeholt; der nächste planmäßige startet normal.

**Ablauf je Durchlauf (Haupt-Thread bzw. Feature-Thread, ohne konkreten Auftrag)**
1. `git status`/`git fetch` prüfen; fremde uncommittete Änderungen nie überschreiben.
2. Offene Issues mit `user-test` auf neue Kommentare prüfen: `BESTANDEN` → Abnahme in `PROJECT_STATUS.md` vermerken, Label `done`, Issue schließen. `FEHLGESCHLAGEN` → Label `needs-fix`, Ursache suchen, beheben, nach dem Merge neue Testschritte kommentieren und wieder `auto-user-test` setzen (siehe Schritt 6). Ein fehlgeschlagener Test wird nie als bestanden markiert.
3. Offene `user-task`-Issues auf Antworten prüfen und umsetzen (z. B. Freigabe → Aufgabe von `Blocked` nach `Ready`); erledigte schließen.
4. Neue `idea-inbox`-Issues übernehmen: Duplikate/Umsetzungsstand prüfen → Eintrag in `docs/IDEAS.md` (mit `#Nummer`, Priorität, Nutzen, Abhängigkeiten, Abnahme) → Label `planned` statt `idea-inbox`. Bereits umgesetzt/ungeeignet → im Issue begründen und schließen.
5. Höchste unblockierte `Ready`-Aufgabe wählen (höchstens 1–2 gleichzeitig), Issue-Label `in-progress`, umsetzen, Checks, Commit, PR nach CI grün mergen.
6. **Nach dem Merge bleibt das Feature-Issue offen**; ein eigenes `[USERTEST]`-Issue gibt es nicht mehr. Ist eine Abnahme sinnvoll: Der **Feature-Thread, der die PR gemergt hat**, schreibt den Kommentar mit den Testschritten ins Feature-Issue (Format unten) und setzt das Label `in-progress` → `auto-user-test`; der Haupt-Thread zieht nur Backlog und Status nach. Danach läuft die automatische Prüfung (siehe „Automatische User-Tests“). Dabei gilt:
   - PRs schreiben „Refs #…“, **nie** „Closes #…“, damit der Merge das Issue nicht schließt.
   - Ist kein User-Test nötig (z. B. reine Test- oder Doku-Änderung), wird das Issue nach dem Merge mit Label `done` geschlossen; der Abschluss-Kommentar sagt das ausdrücklich („kein User-Test nötig“).
   - Geschlossen wird ein Issue mit Test nur durch dein `BESTANDEN`, durch dich selbst oder durch ein eindeutiges „Automatisch BESTANDEN“. Beim Schließen das Status-Label auf `done` setzen (kein `planned`/`in-progress`/`auto-user-test`/`user-test` an geschlossenen Issues).
   - **Format des Testschritte-Kommentars** (das Werkzeug liest es so; der neueste solche Kommentar gilt):
     ```
     ## Testschritte
     **Voraussetzung:** … (optional)

     1. Schritt in Alltagssprache
        → Erwartet: was du sehen solltest
     2. Optional: Schritt, der fehlen darf
        → Erwartet: …
     ```
     Erlaubt sind auch `### Testschritte` und `**Testschritte**` als erste Zeile.
   - **Umzug der alten `[USERTEST]`-Issues (2026-10-17, dein Wunsch):** Jedes offene `[USERTEST]`-Issue zieht ins Original-Feature-Issue um. Das Feature-Issue wird wieder geöffnet und bekommt einen `## Testschritte`-Kommentar (aus dem alten Test übernommen), einen Verlauf-Kommentar (PR, Link zum alten Test-Issue, bisherige Vorprüfungen und deine Antworten) und das passende Label: `auto-user-test`, wenn noch keine Vorprüfung lief, sonst `user-test` mit dem Hinweis, was du anschauen sollst. Deckt ein Test mehrere Features ab, läuft er im Haupt-Issue; die anderen bleiben geschlossen mit dem Kommentar „Test läuft in #…“. Das alte `[USERTEST]`-Issue wird mit „Verschoben nach #… (neues Issue-Modell)“ geschlossen (Grund „not planned“); deine Antworten bleiben dort lesbar.
7. Braucht ein Thread etwas von dir: Issue `[AUFGABE] …` mit Label `user-task` (Blocker zusätzlich `priority: high`), in `docs/IDEAS.md` verlinken.
8. `docs/IDEAS.md` und `docs/PROJECT_STATUS.md` aktualisieren.

**Statusbegriffe (Projektstatus):** implementiert · automatisiert getestet · automatischer User-Test offen (#Issue) · User-Test offen (#Issue) · automatisch bestätigt (Datum) · vom Nutzer bestätigt (Datum) · fehlgeschlagen/Nachbesserung (#Issue) · blockiert. „Done“ im Backlog bedeutet **nicht** automatisch „von dir bestätigt“.

Hinweis: GitHub-Kommentare starten keine Session; Rückmeldungen werden beim nächsten Durchlauf gelesen.

## Rückmeldungen an dich und Dashboard
- **Rückmeldungen (#195):** Ergebnisse stehen im Thread, der die Arbeit gemacht hat; sonst meldet sich ein Thread nur, wenn er etwas von dir braucht (Entscheidung, Test, Freigabe). Keine Fortschrittsmeldungen.
- **Dashboard:** Gesamtansicht und Updater sind im Fitness-Projekt beschrieben: [`fitness-coach/docs/DASHBOARD.md`](https://github.com/mgritsch04/fitness-coach/blob/main/docs/DASHBOARD.md). Seit 2026-10-17 11:25 schreibt jeder Thread sein eigenes Dokument direkt ins Master-Dashboard (https://claude.ai/artifact/DLsyumhy4w8L66F1VNA9pk) mit ArtifactData: Collection `threads`, `doc_id` = die `cmsg_…`-Id der Thread-Wurzel, Inhalt `{project:"wp", title, status:"working"|"blocked"|"done"|"failed", task, issue, env:"cloud"|"pc", updated}`. Neues Dokument: erst `get`, dann `set`; bestehendes: `set` mit `if_version` (bei Abweichung neu lesen und wiederholen). Geschrieben wird ereignisbasiert bei Start, Schrittwechsel und Ende; am Ende `done` oder `failed`, denn Einträge älter als 2 Stunden gelten als still (Regel für beide Projekte; #195 Punkt 6 entfallen). Bis der Leiter etwas anderes meldet, schreibt jeder Thread seine Zeile **zusätzlich** in die alte Zulieferung (Collection `board`, Doc `live`, mit `if_version`; Wortlaut in [`CLAUDE_PROJECT.md`](CLAUDE_PROJECT.md)).

## Automatische User-Tests

Issues mit Label `auto-user-test` werden automatisch geprüft, bevor du selbst testest. Werkzeug und Szenario-Format: [`scripts/usertest/README.md`](../scripts/usertest/README.md).

- **Einplanen:** Die Koordination plant die Testläufe wie normale Aufgaben ein (Kontingent, keine Datei-Überschneidung). Es entstehen **keine neuen Issues**; geprüft wird im vorhandenen Issue. Ein Testlauf baut nichts ein: Wünsche oder Auffälligkeiten kommen als Kommentar ins Issue, die Koordination entscheidet, wann sie drankommen.
- **Schritte:** Bei Feature-Issues kommen sie aus dem neuesten `## Testschritte`-Kommentar, bei alten `[USERTEST]`-Issues aus dem Issue-Text.
- **Warteschlange:** `node scripts/usertest/issues.mjs` listet alle `auto-user-test`-Issues und alten `[USERTEST]`-Issues mit `cloud`/`pc`; `node scripts/usertest/issues.mjs <nr>` liefert die Testschritte als JSON. Nach dem Lauf steht in `report.json` › `actions`, was auf GitHub zu tun ist (Kommentar, Labels, Schließen).
- **Szenario:** Fehlt `scripts/usertest/scenarios/<nr>.mjs`, schreibt der Testlauf es zuerst (Wortlaut von Schritt und Erwartung aus dem Issue) und bringt es per PR in `main`.
- **Cloud oder PC (automatisch):** `node scripts/usertest/run.mjs <nr> --plan` gibt `cloud` oder `pc` aus. `pc` gilt, wenn das Szenario `pc: true` setzt, also ein Schritt die 3D-Optik beurteilt (Material, Licht, Realismus). Ein Cloud-Lauf eines `pc`-Szenarios endet mit dem Urteil `pc` und wird nicht ins Issue geschrieben, sondern auf deinem PC wiederholt.
- **PC-Lauf:** Remote-Control-Sitzung im Ordner `C:\Users\maxim\wohnungsplaner-3d-tests` (Klon in `wp-vorpruefung`): `git fetch origin main && git checkout --detach origin/main`, bei geändertem `package-lock.json` `npm ci`, dann `node scripts/usertest/run.mjs <nr> --gpu --port 4182`. Nennt der Bericht SwiftShader statt der echten Grafikkarte, ist der Lauf ungültig. Die PC-Sitzung meldet `report.json` und Bilder zurück; Kommentar, Artefakt und Labels erledigt die Cloud-Seite.
- **Urteil** (steht in `report.json` › `verdict`, auf der Konsole und im Kopf von `report.md`):
  - `bestanden` = **eindeutig**: jeder Schritt `ok` (optionale `skip` erlaubt), kein `fail`, kein „am Bild beurteilen“, nichts nur am echten Gerät (iPhone) prüfbar, keine Konsolenfehler, und `pc`-Szenarien liefen mit echter Grafikkarte. Dann wird der Test als bestätigt markiert: Kommentar mit `report.md` („Automatisch BESTANDEN“), Label `auto-user-test` → `done`, Issue schließen (Grund „completed“). Den Vermerk in `docs/PROJECT_STATUS.md` („automatisch bestätigt (Datum)“) schreibt der Haupt-Thread.
  - `pruefen` = **nicht eindeutig**: jeder andere Fall, also jede Abweichung, jeder „am Bild beurteilen“-Schritt und jede Prüfung, die nur auf dem iPhone bzw. einem echten Gerät geht. Dann Kommentar mit `report.md` („Automatische Vorprüfung – bitte selbst anschauen: …“ mit der Liste), bei einem Fehlschlag gegebenenfalls mit Screenshot; Label `auto-user-test` → `user-test`, Issue bleibt offen, du antwortest im selben Issue mit `BESTANDEN` oder `FEHLGESCHLAGEN: …`.
  - Ein fehlgeschlagener Schritt wird nie als bestanden markiert; `FEHLGESCHLAGEN` schreibst nur du.
- **Bericht nur im Issue (R4, G 2026-10-17):** Testläufe veröffentlichen nie eigene Artefakte. Der Bericht steht nur als Kommentar im Issue; bei einem Fehlschlag kommt gegebenenfalls ein Screenshot als Anhang oder Bildlink dazu. Keine persönlichen Dateien oder Daten in Issue oder Bericht (das Repo ist öffentlich).

## Modellwahl (#18)
Ziel: das kleinste Modell verwenden, das die Aufgabe sicher schafft, um dein Kontingent zu schonen.

| Aufgabentyp | Modell |
|---|---|
| Doku-Pflege, Issue-Housekeeping, Labels, Formatierung, einfache Textänderungen | Haiku |
| normale Feature-Arbeit (UI, Komponenten), Tests, übliche Fehlersuche, Recherche im Code | Sonnet |
| Kern-Geometrie/Datenmodell (`src/model`, `derivePlan()`, Kollision/Platzierung, Schema-Migrationen), schwierige Fehlersuche (z. B. Rendering-Ursachen), Entscheidungen mit weitreichenden Folgen | Opus |

**Entscheidung:** Jeder Thread wählt das Modell für Hilfsagenten selbst nach dieser Tabelle (dein Auftrag vom 2026-10-16).

**Paralleler Coding-Agent (auf deinen Wunsch):** Für eine klar abgegrenzte Aufgabe, die kaum Dateien mit dem eigenen Thread teilt, kann ein zweiter Agent in einem eigenen Git-Worktree auf eigenem Branch `claude/…` arbeiten (Modell nach Tabelle, meist Sonnet). Regeln: eigener E2E-Port (`PW_PORT=4174`), nie fremde Server/Prozesse beenden, keine Änderungen an `docs/IDEAS.md`/`docs/PROJECT_STATUS.md` (pflegt der Haupt-Thread), kein PR/keine Issue-Änderungen durch den Agenten – der startende Thread prüft sein Ergebnis, öffnet den PR und integriert nach grüner CI. Kosten: verbraucht dein Kontingent entsprechend schneller.

**Was tatsächlich steuerbar ist:**
- Eine laufende Sitzung kann ihr **eigenes** Modell nicht selbst wechseln; das Modell wird beim Start festgelegt (bei dir: Modellauswahl bzw. `/model`, bei Routinen in deren Einstellungen).
- Threads **delegieren** passende Teilaufgaben an Hilfsagenten mit kleinerem Modell (Haiku/Sonnet), z. B. Housekeeping oder breite Codesuche, und prüft deren Ergebnis.
- **Routine:** Für einen Lauf mit höchstens einer Aufgabe reicht meist Sonnet. Du kannst das Modell der Routine unter https://claude.ai/code/routines einstellen; kein Thread ändert es eigenmächtig.
- Wechselt ein Thread für eine Aufgabe das Modell bzw. gibt sie an ein anderes Modell ab und ändert das die Arbeit (z. B. Opus-Sitzung nötig), sagt sie dir das kurz im Chat bzw. im Issue.
- Scheitert eine Aufgabe mit dem kleineren Modell (Tests rot, Ursache unklar), wird sie mit Begründung im Issue an das nächsthöhere Modell bzw. eine von dir gestartete Opus-Sitzung übergeben.

## Geplante Durchläufe (Routine)
- Offizielle Funktion: Claude-Code-**Routines** (Research Preview, auch Pro) starten eine neue Cloud-Session nach Zeitplan, frühestens stündlich. Läufe zählen gegen dein Nutzungskontingent. Ist das Limit erreicht, werden Läufe **abgelehnt** (nicht nachgeholt); der nächste planmäßige Lauf nach dem Zurücksetzen startet normal. Zusatznutzung nur, wenn du „usage credits“ selbst einschaltest. Quelle: https://code.claude.com/docs/en/routines (abgerufen 2026-10-16).
- Stand und Einrichtung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) › „Automatisierung“; fertiger Prompt und Schritte: [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md). Ein Lauf: (1) offenen PR des vorigen Laufs prüfen – CI grün und konfliktfrei → mit Merge-Commit integrieren; rot → zuerst beheben; (2) User-Test-Rückmeldungen und neue Ideen übernehmen; (3) **höchstens eine** Aufgabe umsetzen, Checks, PR öffnen; (4) beenden. Kein direkter Push auf `main`, kein Warten/Pollen auf CI, keine Wiederholungsschleifen.
- Verwalten/abschalten: https://claude.ai/code/routines

## Sitzungsübergreifend
- Zu Beginn: `docs/PROJECT_STATUS.md`, `git status`, `git log` prüfen.
- Auftrag: `docs/MASTER_PROMPT.md`; Konventionen: `CLAUDE.md`.
