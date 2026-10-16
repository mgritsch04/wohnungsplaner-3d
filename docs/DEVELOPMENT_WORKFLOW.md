# Entwicklungs-Workflow

_Stand 2026-10-16 – beschreibt, was in diesem Repository und dieser Umgebung tatsächlich gilt._

## Repository
- GitHub: `mgritsch04/wohnungsplaner-3d`, Standard-Branch `main`.
- Branch-Schutz: **keiner** (geprüft über die GitHub-API am 2026-10-16). Keine Pflicht-Checks.
- CI: `.github/workflows/ci.yml` – Lint, Typprüfung, Unit-Tests, Build; danach E2E (Playwright). Läuft auf Pushes nach `main` und auf Pull Requests.

## Branches
- Entwicklung durch Claude Code (Cloud) auf dem sitzungsgebundenen Branch `claude/quirky-faraday-0d9uep` (Push-Rechte dieser Umgebung sind darauf ausgelegt).
- Integration nach `main` per **Pull Request mit Merge-Commit**, sobald ein Stand lokal vollständig geprüft ist (Lint, `tsc -b`, `npm test`, `npm run build`, `npx playwright test`). Der Nutzer hat autonome Integration getesteter Stände erlaubt.
- Kein Branch pro Kleinigkeit; neue Branches nur für riskante/experimentelle Arbeiten.
- Merge erst, wenn auch die GitHub-CI des PR grün ist; danach `main` per `git fetch` prüfen und den Arbeits-Branch per Fast-Forward auf `main` nachziehen (keine History-Umschreibung).
- Verlauf: PR #1 (Stand bis CI-Einführung) am 2026-10-16 nach grüner CI gemergt (`5797457`).

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
- **Neben-Session (mobil, Ideenerfassung):** legt ausschließlich GitHub-Issues mit Label `idea-inbox` an oder ergänzt offene `idea-inbox`-Issues per Kommentar. Ändert **keine** Projektdateien, keine Labels anderer Issues, keine PRs. Anleitung: [`IDEA_CAPTURE.md`](IDEA_CAPTURE.md).
- **Hauptsession (Entwicklung):** einzige Stelle, die `docs/IDEAS.md` pflegt; übernimmt Ideen, setzt um, testet, legt User-Test-Issues an, integriert.
- **Du (Nutzer):** Ideen erfassen, User-Tests durchführen und im Issue mit `BESTANDEN` bzw. `FEHLGESCHLAGEN: …` antworten, Entscheidungen treffen.

**Labels (Status; je Issue genau eines)**
| Label | Bedeutung |
|---|---|
| `idea-inbox` | neue Idee, noch nicht übernommen |
| `planned` | geprüft und in `docs/IDEAS.md` aufgenommen (Ready/Blocked/Inbox dort) |
| `in-progress` | wird umgesetzt |
| `user-test` | `[USERTEST]`-Issue: manuelle Prüfung durch dich offen |
| `needs-fix` | dein User-Test ist fehlgeschlagen (Issue bleibt offen) |
| `done` | vollständig abgeschlossen (bei User-Tests: von dir bestanden) |
| `user-task` | `[AUFGABE]`-Issue: die Hauptsession braucht etwas von dir (Freigabe, Entscheidung, Datei, Netzfreigabe) |

Zusatzlabels (neben dem Status): `priority: high` (Blocker und dringende Punkte, vor neuen Ideen bearbeiten), `info` (erledigt, enthält aber eine wichtige Info für dich – du schließt es), `blocked` (von der Ideen-Session vergeben, wenn etwas offensichtlich blockiert ist).

**Prioritäten beim Start und zwischen Aufgaben (#34, #35, #40)**
1. Ein ausdrücklicher Auftrag von dir im Chat geht immer vor.
2. **Fehlgeschlagene User-Tests** (`FEHLGESCHLAGEN` in einem `user-test`-Issue, Label `needs-fix`) – vorhandene Funktionen reparieren und abschließen. Vorher prüfen, ob der getestete Stand schon in `main` war; wenn nicht, im Issue darauf hinweisen und nach dem Merge neu testen lassen (kein Fehlschlag).
3. **Issues mit `priority: high`**, die Aufgaben für Claude Code sind – vor neuen Ideen und vor `Ready`-Aufgaben.
4. **Deine Kommentare** in offenen Issues (Antworten auf `user-task`, Rückfragen) zeitnah verarbeiten.
5. Neue `idea-inbox`-Issues übernehmen, dann die oberste `Ready`-Zeile in `docs/IDEAS.md`.

**Issue-Pflege (#35, #36)**
- Issue-Check **zu Sitzungsbeginn und nach jeder abgeschlossenen Aufgabe** (nach Commit/PR): neue/geänderte Issues seit dem letzten Check lesen. Einen dauerhaft im Hintergrund laufenden Prüfer gibt es innerhalb einer Sitzung nicht (kein Pollen); zwischen Sitzungen übernimmt das die Routine (#30). Für das Auflisten/Zusammenfassen dürfen Hilfsagenten mit kleinem Modell eingesetzt werden (siehe „Modellwahl“).
- **Fertige Aufgaben werden geschlossen** (Label `done`), sobald der Stand in `main` ist – nicht nur kommentiert. Steht noch eine wichtige Info für dich drin, bekommt das Issue zusätzlich das Label **`info`** und bleibt offen; du schließt es selbst oder per Kommentar. Wirklich offene Aufgaben bleiben offen.
- `user-task`-Issues werden geschlossen, sobald deine Antwort umgesetzt bzw. in `docs/IDEAS.md` eingeplant ist.

**`docs/IDEAS.md` und Branches (#40)**
- Direkte Pushes auf `main` sind tabu (Schutzregel). Deshalb wird `docs/IDEAS.md` auf dem Arbeits-Branch gepflegt und **zügig per PR in `main` integriert**; der Stand in `main` ist maßgeblich. Bearbeitest du die Datei selbst (z. B. im GitHub-Web), bitte auf `main` oder auf dem Arbeits-Branch – die Hauptsession holt die Änderung vor dem eigenen Bearbeiten per Merge/Fast-Forward und überschreibt sie nie.
- Mehrere Branches sind erlaubt, wenn sinnvoll (z. B. ein reiner Doku-PR parallel zu einer Feature-Arbeit), immer `claude/…`-Präfix, jeder über PR mit grüner CI. Bei parallelen Änderungen an `docs/IDEAS.md` auf verschiedenen Branches Konflikte vor dem Merge auflösen, nie per Force-Push.

**Kontingent (#13):** Nur das Kontingent deines Pro-Plans. Die Hauptsession kauft nichts, aktiviert keine „usage credits“ oder Zusatznutzung und ändert keine Abrechnungseinstellungen (kann sie auch nicht). Ist das Kontingent erschöpft, stoppt die laufende Sitzung; sie kann sich **nicht** selbst nach dem Zurücksetzen neu starten. Fortgesetzt wird durch deine Nachricht („weiter“) oder den nächsten planmäßigen Routine-Lauf (#30). Ein abgelehnter Routine-Lauf wird nicht nachgeholt; der nächste planmäßige startet normal.

**Ablauf je Durchlauf der Hauptsession (ohne konkreten Auftrag)**
1. `git status`/`git fetch` prüfen; fremde uncommittete Änderungen nie überschreiben.
2. Offene `user-test`-Issues auf neue Kommentare prüfen: `BESTANDEN` → Abnahme in `PROJECT_STATUS.md` vermerken, Label `done`, Issue schließen. `FEHLGESCHLAGEN` → Label `needs-fix`, Ursache suchen, beheben, danach im Issue um erneuten Test bitten (Label wieder `user-test`). Ein fehlgeschlagener Test wird nie als bestanden markiert.
3. Offene `user-task`-Issues auf Antworten prüfen und umsetzen (z. B. Freigabe → Aufgabe von `Blocked` nach `Ready`); erledigte schließen.
4. Neue `idea-inbox`-Issues übernehmen: Duplikate/Umsetzungsstand prüfen → Eintrag in `docs/IDEAS.md` (mit `#Nummer`, Priorität, Nutzen, Abhängigkeiten, Abnahme) → Label `planned` statt `idea-inbox`. Bereits umgesetzt/ungeeignet → im Issue begründen und schließen.
5. Höchste unblockierte `Ready`-Aufgabe wählen (höchstens 1–2 gleichzeitig), Issue-Label `in-progress`, umsetzen, Checks, Commit, PR nach CI grün mergen.
6. Wenn eine manuelle Abnahme sinnvoll ist: Issue `[USERTEST] …` mit Label `user-test` (Anleitung für Nicht-Entwickler, erwartete Ergebnisse, Verweis auf Issue/PR, Voraussetzungen). Implementierungs-Issue danach `done` und schließen – die Abnahme läuft über das Test-Issue.
7. Braucht die Hauptsession etwas von dir: Issue `[AUFGABE] …` mit Label `user-task` (Blocker zusätzlich `priority: high`), in `docs/IDEAS.md` verlinken.
8. `docs/IDEAS.md` und `docs/PROJECT_STATUS.md` aktualisieren.

**Statusbegriffe (Projektstatus):** implementiert · automatisiert getestet · User-Test offen (#Issue) · vom Nutzer bestätigt (Datum) · fehlgeschlagen/Nachbesserung (#Issue) · blockiert. „Done“ im Backlog bedeutet **nicht** automatisch „von dir bestätigt“.

Hinweis: GitHub-Kommentare starten keine Session; Rückmeldungen werden beim nächsten Durchlauf gelesen.

## Modellwahl (#18)
Ziel: das kleinste Modell verwenden, das die Aufgabe sicher schafft, um dein Kontingent zu schonen.

| Aufgabentyp | Modell |
|---|---|
| Doku-Pflege, Issue-Housekeeping, Labels, Formatierung, einfache Textänderungen | Haiku |
| normale Feature-Arbeit (UI, Komponenten), Tests, übliche Fehlersuche, Recherche im Code | Sonnet |
| Kern-Geometrie/Datenmodell (`src/model`, `derivePlan()`, Kollision/Platzierung, Schema-Migrationen), schwierige Fehlersuche (z. B. Rendering-Ursachen), Entscheidungen mit weitreichenden Folgen | Opus |

**Was tatsächlich steuerbar ist:**
- Eine laufende Sitzung kann ihr **eigenes** Modell nicht selbst wechseln; das Modell wird beim Start festgelegt (bei dir: Modellauswahl bzw. `/model`, bei Routinen in deren Einstellungen).
- Die Hauptsession **delegiert** passende Teilaufgaben an Hilfsagenten mit kleinerem Modell (Haiku/Sonnet), z. B. Housekeeping oder breite Codesuche, und prüft deren Ergebnis.
- **Routine:** Für einen Lauf mit höchstens einer Aufgabe reicht meist Sonnet. Du kannst das Modell der Routine unter https://claude.ai/code/routines einstellen; die Hauptsession ändert es nicht eigenmächtig.
- Scheitert eine Aufgabe mit dem kleineren Modell (Tests rot, Ursache unklar), wird sie mit Begründung im Issue an das nächsthöhere Modell bzw. eine von dir gestartete Opus-Sitzung übergeben.

## Geplante Durchläufe (Routine)
- Offizielle Funktion: Claude-Code-**Routines** (Research Preview, auch Pro) starten eine neue Cloud-Session nach Zeitplan, frühestens stündlich. Läufe zählen gegen dein Nutzungskontingent. Ist das Limit erreicht, werden Läufe **abgelehnt** (nicht nachgeholt); der nächste planmäßige Lauf nach dem Zurücksetzen startet normal. Zusatznutzung nur, wenn du „usage credits“ selbst einschaltest. Quelle: https://code.claude.com/docs/en/routines (abgerufen 2026-10-16).
- Stand und Einrichtung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) › „Automatisierung“; fertiger Prompt und Schritte: [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md). Ein Lauf: (1) offenen PR des vorigen Laufs prüfen – CI grün und konfliktfrei → mit Merge-Commit integrieren; rot → zuerst beheben; (2) User-Test-Rückmeldungen und neue Ideen übernehmen; (3) **höchstens eine** Aufgabe umsetzen, Checks, PR öffnen; (4) beenden. Kein direkter Push auf `main`, kein Warten/Pollen auf CI, keine Wiederholungsschleifen.
- Verwalten/abschalten: https://claude.ai/code/routines

## Sitzungsübergreifend
- Zu Beginn: `docs/PROJECT_STATUS.md`, `git status`, `git log` prüfen.
- Auftrag: `docs/MASTER_PROMPT.md`; Konventionen: `CLAUDE.md`.
