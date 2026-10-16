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

**Ablauf je Durchlauf der Hauptsession (ohne konkreten Auftrag)**
1. `git status`/`git fetch` prüfen; fremde uncommittete Änderungen nie überschreiben.
2. Offene `user-test`-Issues auf neue Kommentare prüfen: `BESTANDEN` → Abnahme in `PROJECT_STATUS.md` vermerken, Label `done`, Issue schließen. `FEHLGESCHLAGEN` → Label `needs-fix`, Ursache suchen, beheben, danach im Issue um erneuten Test bitten (Label wieder `user-test`). Ein fehlgeschlagener Test wird nie als bestanden markiert.
3. Neue `idea-inbox`-Issues übernehmen: Duplikate/Umsetzungsstand prüfen → Eintrag in `docs/IDEAS.md` (mit `#Nummer`, Priorität, Nutzen, Abhängigkeiten, Abnahme) → Label `planned` statt `idea-inbox`. Bereits umgesetzt/ungeeignet → im Issue begründen und schließen.
4. Höchste unblockierte `Ready`-Aufgabe wählen (höchstens 1–2 gleichzeitig), Issue-Label `in-progress`, umsetzen, Checks, Commit, PR nach CI grün mergen.
5. Wenn eine manuelle Abnahme sinnvoll ist: Issue `[USERTEST] …` mit Label `user-test` (Anleitung für Nicht-Entwickler, erwartete Ergebnisse, Verweis auf Issue/PR, Voraussetzungen). Implementierungs-Issue danach `done` und schließen – die Abnahme läuft über das Test-Issue.
6. `docs/IDEAS.md` und `docs/PROJECT_STATUS.md` aktualisieren.

**Statusbegriffe (Projektstatus):** implementiert · automatisiert getestet · User-Test offen (#Issue) · vom Nutzer bestätigt (Datum) · fehlgeschlagen/Nachbesserung (#Issue) · blockiert. „Done“ im Backlog bedeutet **nicht** automatisch „von dir bestätigt“.

Hinweis: GitHub-Kommentare starten keine Session; Rückmeldungen werden beim nächsten Durchlauf gelesen.

## Geplante Durchläufe (Routine)
- Offizielle Funktion: Claude-Code-**Routines** (Research Preview, auch Pro) starten eine neue Cloud-Session nach Zeitplan, frühestens stündlich. Läufe zählen gegen dein Nutzungskontingent. Ist das Limit erreicht, werden Läufe **abgelehnt** (nicht nachgeholt); der nächste planmäßige Lauf nach dem Zurücksetzen startet normal. Zusatznutzung nur, wenn du „usage credits“ selbst einschaltest. Quelle: https://code.claude.com/docs/en/routines (abgerufen 2026-10-16).
- Eingerichtet: siehe [`PROJECT_STATUS.md`](PROJECT_STATUS.md) › „Automatisierung“ (Name, Zeitplan, Inhalt). Ein Lauf: (1) offenen PR des vorigen Laufs prüfen – CI grün und konfliktfrei → mit Merge-Commit integrieren; rot → zuerst beheben; (2) User-Test-Rückmeldungen und neue Ideen übernehmen; (3) **höchstens eine** Aufgabe umsetzen, Checks, PR öffnen; (4) beenden. Kein direkter Push auf `main`, kein Warten/Pollen auf CI, keine Wiederholungsschleifen.
- Verwalten/abschalten: https://claude.ai/code/routines

## Sitzungsübergreifend
- Zu Beginn: `docs/PROJECT_STATUS.md`, `git status`, `git log` prüfen.
- Auftrag: `docs/MASTER_PROMPT.md`; Konventionen: `CLAUDE.md`.
