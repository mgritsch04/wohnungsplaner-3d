# Aufträge der Hauptsession für die lokale Sitzung „Hallo“

Spiegel von Issue #110 (Aufgaben-Kanal). Diese Datei wird bei jeder neuen Aufgabe aktualisiert.
Lesen: `git fetch origin claude/local-session-tasks` und dann `git show origin/claude/local-session-tasks:LOCAL_TASKS.md`.
Nicht auf diesen Branch pushen. Berichte gehen per Nachricht an die Hauptsession.
Regeln: eigener Branch je Aufgabe, kein Push auf main, kein Force-Push, keine PRs, keine Issue-Änderungen, docs/IDEAS.md und docs/PROJECT_STATUS.md nicht anfassen. Commit-Trailer:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017X7PnLx9bCA5dQWidUEW86

## Rückmeldung zu Aufgabe 5 (Nutzungs-Limit): wird angehalten
Danke für die gründliche Untersuchung. Ergebnis: Ein Takt von 60 s ist mit dokumentierten Mitteln nicht zuverlässig erreichbar, weil
- die Status-Line in der Desktop-App nicht läuft und
- `rate_limits` nur nach Antworten der jeweiligen Sitzung frisch sind.

Das Dashboard bekommt die Prozentwerte weiter aus den Sitzungsdaten über die Hauptsession. **Bitte keine weiteren Änderungen an den Einstellungen des Nutzers**: das Script `usage-add-mcp.cjs` nicht ausführen und nichts an der Desktop-App-Konfiguration. Ob die vorhandene `statusLine` wieder entfernt wird, entscheidet der Nutzer; bis dahin bleibt sie.

## Aufgabe 6: Küchen-Arbeitsdreieck prüfen (#82)

**Branch:** `claude/kitchen-triangle-82` von `origin/main`. Vor dem finalen Push `git merge origin/main`, kein Rebase.

**Ziel:** Issue #82 lesen (`gh issue view 82 -R mgritsch04/wohnungsplaner-3d`).

1. **Reine Funktion** in `src/model/` (oder `src/kitchen/`, siehe vorhandenes `src/kitchen/kitchen.ts`):
   - Sie findet in einem Raum **Spüle**, **Herd/Kochfeld** und **Kühlschrank** anhand der Katalog-Kategorien bzw. IDs der Küchenmodule (vorher im Katalog prüfen, welche es gibt; nichts erfinden).
   - Sie berechnet die drei Seiten des Arbeitsdreiecks von Mitte Vorderkante zu Mitte Vorderkante und die Summe.
   - Bewertung nach gängiger Faustregel: jede Seite 1,2–2,7 m, Summe 4–8 m. Im UI als „Richtwert, keine Norm“ kennzeichnen.
   - Fehlt ein Element, kommt eine klare Meldung.
2. **Anzeige:**
   - 2D: Dreieck als gestrichelte Linien mit Längen. Grün im Richtwert, orange außerhalb.
   - Dazu eine kurze Auswertung im Küchen-Panel (`src/ui/panels/` → Küche).
   - Ein-/ausschaltbar. Ein eigenes Overlay in `src/editor2d/`, das `Editor2D.tsx` nur einhängt.
3. **Farben:** Design-Tokens aus `src/theme.css`, keine festen Farben (`src/ui/theme.test.ts`). Hell und dunkel prüfen.

**Nicht anfassen:**
- `src/ui/panels/PropertiesPanel.tsx` und `src/versions/**` (dort arbeiten Agents an #99 und #76)
- `docs/IDEAS.md`, `docs/PROJECT_STATUS.md`
- Issues

**Tests:**
- **Unit:** Dreieck im Richtwert, eine Seite zu kurz, Summe zu lang, fehlendes Element, Raum ohne Küche.
- **E2E** am Ende von `e2e/app.spec.ts`: Küchenzeile planen (siehe bestehenden Test „plans a kitchen run …“), Dreieck mit Längen sichtbar, Ausschalten blendet aus.

**Fertig, wenn:**
- alle Checks und die volle E2E-Suite grün sind;
- auf `claude/kitchen-triangle-82` gepusht ist;
- du mir per Nachricht berichtet hast: Regeln, Dateien, Tests, Commits, User-Test-Schritte.

## Ergänzung zu Aufgabe 6
Laut #82 sollen die Grenzwerte **einstellbar** sein. Dafür reichen zwei Felder im Küchen-Panel: Seitenlänge min/max und Summe max, mit den Faustregel-Werten als Standard. Gespeichert werden sie in den Projekt-Einstellungen mit Default, damit alte Projekte unverändert laden.

Außerdem muss sich die Prüfung beim Verschieben der Geräte aktualisieren. Während des Ziehens darf sie ruhig pausieren, wie bei den Engstellen.
