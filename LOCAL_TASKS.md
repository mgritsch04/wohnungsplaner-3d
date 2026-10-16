# Aufträge der Hauptsession für die lokale Sitzung „Hallo“

Spiegel von Issue #110 (Aufgaben-Kanal). Diese Datei wird bei jeder neuen Aufgabe aktualisiert.
Lesen: `git fetch origin claude/local-session-tasks` und dann `git show origin/claude/local-session-tasks:LOCAL_TASKS.md`.
Nicht auf diesen Branch pushen. Berichte gehen per Nachricht an die Hauptsession.
Regeln: eigener Branch je Aufgabe, kein Push auf main, kein Force-Push, keine PRs, keine Issue-Änderungen, docs/IDEAS.md und docs/PROJECT_STATUS.md nicht anfassen. Commit-Trailer:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017X7PnLx9bCA5dQWidUEW86

## Rückmeldung zu Aufgabe 2 (#68 Mindestbreiten)
Danke, gute Heuristik und saubere Begründung. Ab jetzt bitte nichts mehr auf `claude/min-widths-68` pushen; die Hauptsession integriert.

Zu deinen zwei Fehlschlägen auf `main`:
- „click vs. drag“ ist bereits behoben (Toleranz von einem Rasterschritt, kommt mit der nächsten Integration).
- „doors and windows (#21)“ untersucht die Hauptsession.

Bitte nichts davon selbst ändern.

## Aufgabe 3: Laufwege messen (#67)

**Branch:** `claude/walk-paths-67`, Basis ist dein eigener Branch `origin/claude/min-widths-68`, weil du die Hindernis-Logik wiederverwendest:
```
git fetch origin
git checkout -b claude/walk-paths-67 origin/claude/min-widths-68
```
Vor dem finalen Push `git merge origin/main` (kein Rebase).

**Ziel (Akzeptanzkriterien aus #67)**
1. **Werkzeug „Laufweg“** im 2D-Plan, z. B. Taste **L**; vorher prüfen, dass L frei ist.
   - Zwei Punkte anklicken: Start und Ziel.
   - Der kürzeste begehbare Weg wird als Linie mit der Länge in Metern angezeigt, z. B. „7,40 m“.
   - Esc bricht ab, ein neuer Klick beginnt einen neuen Weg.
   - Der Weg ist **nur Anzeige** und wird nicht im Projekt gespeichert. Damit gibt es keine Schema-Änderung und keinen Undo-Schritt.
2. **Wegsuche als reine Funktion**, z. B. `src/model/walkPath.ts`: `shortestWalkPath(project, derived, a, b, opts)`.
   - Hindernisse: Wände; geschlossene Türen (`opening.open === false`) blockieren, offene Türen und Durchgänge sind passierbar; Möbel nach denselben Regeln wie deine Engstellen-Prüfung (Teppiche, Hängeschränke usw. sind kein Hindernis).
   - Ein Körperradius von ca. 25 cm, damit der Weg nicht an Kanten klebt.
   - Algorithmus nach Wahl: Raster-A* (z. B. 5 cm) mit anschließender Glättung (String-Pulling), oder Sichtbarkeitsgraph. Begründe die Wahl im Datei-Kommentar.
   - Ist kein Weg möglich, gibt es eine klare Meldung „Kein Weg gefunden (blockiert durch …)“.
3. **Performance:** In der Beispielwohnung höchstens ~50 ms pro Berechnung, ein Unit-Test mit Grenze. Neu gerechnet wird nur beim Klicken bzw. beim Ändern von Start/Ziel, nicht in jedem Frame.
4. **Optional, wenn es sich anbietet:** Den Weg zusätzlich in 3D als dezente Bodenlinie zeigen, als eigene Komponente.

**Nicht anfassen:**
- `src/import/**`
- `src/persistence/**`, `src/versions/**`
- `src/export/**`
- `src/budget/**`
- `docs/IDEAS.md`, `docs/PROJECT_STATUS.md`
- `src/ui/Modals.tsx`, `src/ui/dialogStore.ts`

**Tests**
- **Unit:**
  - gerader Weg in einem leeren Raum hat die Luftlinien-Länge;
  - Umweg um ein Möbel ist länger als die Luftlinie;
  - Weg durch eine offene Tür in den Nachbarraum;
  - geschlossene Tür ergibt keinen Weg bzw. einen Umweg;
  - Teppich blockiert nicht;
  - Performance.
- **E2E** am Ende von `e2e/app.spec.ts`:
  - Beispielwohnung, Werkzeug Laufweg, Klick im Wohnzimmer und Klick im Schlafzimmer;
  - die Linie und eine Länge in m sind sichtbar, plausibel größer als die Luftlinie;
  - Esc entfernt den Weg;
  - keine Konsolenfehler.

**Fertig, wenn**
- alle Checks plus die volle E2E-Suite grün sind (bekannte Fehlschläge auf `main` bitte wie bisher getrennt nennen),
- `git push -u origin claude/walk-paths-67` erfolgt ist,
- du mir per Nachricht berichtet hast: Commits, Dateien, Algorithmus, Testergebnisse, Schritte für den User-Test.
