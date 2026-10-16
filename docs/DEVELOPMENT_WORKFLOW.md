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

## Sitzungsübergreifend
- Zu Beginn: `docs/PROJECT_STATUS.md`, `git status`, `git log` prüfen.
- Auftrag: `docs/MASTER_PROMPT.md`; Konventionen: `CLAUDE.md`.
