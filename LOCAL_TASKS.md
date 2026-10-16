# Aufträge der Hauptsession für die lokale Sitzung „Hallo“

Spiegel von Issue #110 (Aufgaben-Kanal). Diese Datei wird bei jeder neuen Aufgabe aktualisiert.
Lesen: `git fetch origin claude/local-session-tasks` und dann `git show origin/claude/local-session-tasks:LOCAL_TASKS.md`.
Nicht auf diesen Branch pushen. Berichte gehen per Nachricht an die Hauptsession.
Regeln: eigener Branch je Aufgabe, kein Push auf main, kein Force-Push, keine PRs, keine Issue-Änderungen, docs/IDEAS.md und docs/PROJECT_STATUS.md nicht anfassen. Commit-Trailer:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017X7PnLx9bCA5dQWidUEW86

## Rückmeldung zu Aufgabe 3 (#67 Laufwege)
Danke, saubere Arbeit. Ab jetzt bitte nichts mehr auf `claude/walk-paths-67` pushen. Die Taste L trage ich bei der Integration in die neue Tastenkürzel-Übersicht ein (`src/ui/shortcutCatalog.ts`, kommt mit PR #117).

## Aufgabe 4: E2E-Fehler „doors and windows (#21)“ auf Windows finden und beheben

Der Test `3D: doors and windows open/close …` schlägt bei dir in der **vollen** Suite reproduzierbar fehl („selection null statt Tür-ID“). Einzeln läuft er grün. In der Cloud ist er auch in der vollen Suite grün (42/42), deshalb kannst nur du das untersuchen.

**Branch:** `claude/fix-doors-e2e`, Basis ist der Integrations-Branch mit dem neuesten Stand:
```
git fetch origin
git checkout -b claude/fix-doors-e2e origin/claude/quirky-faraday-0d9uep
```
Dort ist auch „click vs. drag“ schon repariert.

**Vorgehen**
1. **Reproduzieren:** `npx playwright test` (voll) mit `--trace on` bzw. `--trace retain-on-failure`. Zusätzlich herausfinden, welcher vorherige Test den Fehler auslöst: nur die Tests davor plus den Türen-Test laufen lassen, halbieren. Ist es Last bzw. Timing (z. B. Kamera noch in Bewegung, Fenstergröße, Fokus, Pointer-Lock, offene Hover-Karte über der Tür)?
2. **Ursache benennen**, mit Beleg: Trace, Screenshot im Fehlerfall, Konsole.
3. **Beheben:**
   - Ist es ein echter App-Fehler (z. B. ein Klick wird verschluckt, ein Zustand aus einem vorherigen Test bleibt hängen), dann den App-Code korrigieren.
   - Ist es reines Test-Timing, dann den Test robust machen, z. B. warten, bis die Kamera stillsteht, statt einer festen `waitForTimeout`.
   - **Keinen Test überspringen oder abschwächen**, nur weil er rot ist.
4. **Prüfen:** Die volle Suite muss danach bei dir **zweimal hintereinander** grün sein.

**Nicht anfassen:**
- `docs/IDEAS.md`, `docs/PROJECT_STATUS.md`
- Issues, Labels, PRs
- `src/styles.css` und Farben (ein anderer Agent überarbeitet sie gerade)
- Ausrichten/Verteilen im Eigenschaften-Panel (ebenfalls ein anderer Agent)

**Fertig, wenn**
- `git push -u origin claude/fix-doors-e2e` erfolgt ist,
- du mir per Nachricht berichtet hast: Ursache mit Beleg, Änderung, beide Testläufe, Commits.
