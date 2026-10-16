# Hinweise für Claude Code (Projektkonventionen)

* Vollständiger Auftrag: `docs/MASTER_PROMPT.md`. Aktueller Stand: `docs/PROJECT_STATUS.md` – zu Sitzungsbeginn lesen, nach Meilensteinen aktualisieren.
* Mit dem Nutzer **Deutsch** sprechen.
* Checks: `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`, `npx playwright test` (E2E, startet vite preview; ein laufender alter `vite preview` auf Port 4173 wird wiederverwendet – vorher beenden).
* Kleine, fokussierte Commits mit Präfix (`feat:`, `fix:`, `test:`, `perf:`, `docs:`), nach den relevanten Checks; danach pushen und Ergebnis prüfen.
* Architektur: eine Quelle der Wahrheit (`src/model`), abgeleitete Geometrie in `derivePlan()`; Händler-Integrationen nur in `src/catalog/providers`, nie im Geometrie-Kern.
* Keine Secrets committen, keine Scraping-/Umgehungstechniken, keine erfundenen Produktdaten.
