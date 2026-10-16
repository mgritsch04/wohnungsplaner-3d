# Aufträge der Hauptsession für die lokale Sitzung „Hallo“

Spiegel von Issue #110 (Aufgaben-Kanal). Diese Datei wird bei jeder neuen Aufgabe aktualisiert.
Lesen: `git fetch origin claude/local-session-tasks` und dann `git show origin/claude/local-session-tasks:LOCAL_TASKS.md`.
Nicht auf diesen Branch pushen. Berichte gehen per Nachricht an die Hauptsession.
Regeln: eigener Branch je Aufgabe, kein Push auf main, kein Force-Push, keine PRs, keine Issue-Änderungen, docs/IDEAS.md und docs/PROJECT_STATUS.md nicht anfassen. Commit-Trailer:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017X7PnLx9bCA5dQWidUEW86

## Rückmeldung zu Aufgabe 1 (#71/#72 Plan-Export)
Danke, das ist sauber umgesetzt. Ab jetzt bitte **nichts mehr auf `claude/plan-export-71` pushen**. Die Hauptsession übernimmt Integration, PR und Merge.

## Aufgabe 2: Mindestbreiten prüfen – Engstellen markieren (#68)

**Branch:** `claude/min-widths-68` von `origin/main`:
```
git fetch origin
git checkout -b claude/min-widths-68 origin/main
```
Vor dem finalen Push nochmals `git merge origin/main` (kein Rebase). Bis dahin ist vermutlich auch PR #109 (Türen/Fenster) in `main`.

**Ziel (Akzeptanzkriterien aus #68)**
1. **Einstellung:** `settings.minPassageWidth` in `src/model/schema.ts`.
   - Standard 0,90 m, Bereich 0,60–1,50 m.
   - Alte Projekte laden unverändert, über den Default.
   - UI-Feld im Werkzeug-Panel (`src/ui/panels/ToolsPanel.tsx`) mit Hinweis „Richtwert, keine Norm“, dazu ein Schalter „Engstellen anzeigen“.
2. **Prüfung als reine Funktion**, z. B. `src/model/passages.ts`, die aus Projekt und `derivePlan()` die Engstellen berechnet. Die Geometrie gehört in `src/model`, nicht in UI-Komponenten.
   - **Lücken zwischen Hindernissen:** zwischen zwei Möbeln und zwischen Möbel und Wand im selben Raum. Nur echte Durchgänge zählen: Abstand > 5 cm und < Mindestbreite. Bewusst zusammengestellte Möbel bleiben dadurch außen vor.
   - **Teppiche** und andere flache Teile (siehe `placementRules.ts`) zählen nicht als Hindernis.
   - **Möbel in Wandnähe:** Steht ein Möbel nur mit kleinem Abstand an der Wand, ohne dass dahinter ein Weg sinnvoll ist (z. B. < 25 cm), ist das keine Engstelle. Die Heuristik bitte begründen und testen.
   - **Türen und Durchgänge:** Eine lichte Breite unter dem Mindestwert ergibt eine Warnung.
   - Ergebnis je Engstelle: die zwei Punkte der engsten Stelle, die Breite und der Bezug (welche Möbel/Wand/Tür).
3. **Anzeige 2D:** Engstellen als rote Maßlinie mit der Breite in cm im Plan, nur wenn „Engstellen anzeigen“ aktiv ist. Minimal in `src/editor2d/` als eigene Komponente, die `Editor2D.tsx` nur einhängt.
4. **Anzeige 3D:** dezente rote Markierung am Boden an der Engstelle, als eigene Komponente in `src/view3d/`, eingehängt in `Scene3D.tsx`.
5. **Performance:** Die Prüfung darf das Ziehen nicht ausbremsen.
   - Mit `useMemo` rechnen bzw. erst nach dem Loslassen.
   - Ein Unit-Test mit 25 Räumen bleibt deutlich unter 16 ms, analog zu `src/model/perf.test.ts`.

**Nicht anfassen:**
- `src/import/**` und `src/ui/panels/ImportPanel.tsx` (#37)
- `src/persistence/**` und ein neuer Versionen-Dialog (#66, ein anderer Agent)
- `src/export/**`
- `docs/IDEAS.md`, `docs/PROJECT_STATUS.md`

**Tests**
- **Unit:**
  - schmale Lücke zwischen zwei Möbeln erkannt,
  - breite Lücke nicht,
  - zusammengestellte Möbel nicht,
  - Teppich ignoriert,
  - schmale Tür erkannt,
  - Mindestwert änderbar,
  - Migration alter Projekte,
  - Performance.
- **E2E** am Ende von `e2e/app.spec.ts`:
  - Beispielwohnung laden, ein Möbel so verschieben, dass ein ca. 60-cm-Durchgang entsteht.
  - Rote Markierung mit „60 cm“ im 2D-Plan sichtbar.
  - Mindestwert auf 50 cm stellen → Markierung weg.
  - In 3D keine Konsolenfehler.

**Fertig, wenn**
- alle Checks plus die volle E2E-Suite grün sind,
- `git push -u origin claude/min-widths-68` erfolgt ist,
- du mir per Nachricht berichtet hast: Commits, Dateien, Heuristik, Testergebnisse, Schritte für den User-Test.

Danach hier im Issue nach Aufgabe 3 schauen.
