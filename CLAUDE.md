# Hinweise für Claude Code (Projektkonventionen)

* Vollständiger Auftrag: `docs/MASTER_PROMPT.md`. Aktueller Stand: `docs/PROJECT_STATUS.md` – zu Sitzungsbeginn lesen, nach Meilensteinen aktualisieren.
* Mit dem Nutzer **Deutsch** sprechen.
* Checks: `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`, `npx playwright test` (E2E, startet vite preview; ein laufender alter `vite preview` auf Port 4173 wird wiederverwendet – vorher beenden).
* Kleine, fokussierte Commits mit Präfix (`feat:`, `fix:`, `test:`, `perf:`, `docs:`, `ci:`), nach den relevanten Checks; danach pushen und Ergebnis prüfen.
* Architektur: eine Quelle der Wahrheit (`src/model`), abgeleitete Geometrie in `derivePlan()`; Händler-Integrationen nur in `src/catalog/providers`, nie im Geometrie-Kern.
* Keine Secrets committen, keine Scraping-/Umgehungstechniken, keine erfundenen Produktdaten.
* Ideen-Backlog: `docs/IDEAS.md` (nur der Haupt-Thread pflegt ihn). Ohne konkreten Auftrag: Ablauf in `docs/DEVELOPMENT_WORKFLOW.md` › „Ideen, Aufgaben und Abnahme über GitHub-Issues“ (User-Test-Rückmeldungen, `idea-inbox`-Issues, dann höchste unblockierte `Ready`-Aufgabe). Konkrete Aufträge haben Vorrang. Nie einen fehlgeschlagenen User-Test als bestanden markieren.
* Smart Home: Konzept in `docs/smart-home/` (nur Planung; keine Home-Assistant-Zugangsdaten im Browser-Code).
* Ein-Projekt-Modell (seit 22.10.2026): Der Planer-Thread im Manager-Projekt ist hier der Haupt-Thread und pflegt das Backlog; der Manager steuert nur, wann gearbeitet wird (Usage). Zustand steht in Dateien, nicht in Sessions. Branches `claude/wp-…`; nach dem Klonen einmal `chmod +x scripts/repo-guard.sh scripts/githooks/pre-push && git config core.hooksPath scripts/githooks`. Nur dieses Repo anfassen; Issue-/PR-Verweise immer als `owner/repo#nr`.
* Auto-Test-Maßstab (seit 23.10.): Optik, Gefühl und Wortlaut beurteilt der Test-Thread selbst; `user-test` nur bei echtem Gerät/echten Daten/echtem Chat (`docs/DEVELOPMENT_WORKFLOW.md` › „Automatische User-Tests“). Cloudflare-Deploy nur mit Gs Freigabe. Keine persönlichen Daten (Wohnung, Benutzerpfade, Pläne) in dieses öffentliche Repo.
