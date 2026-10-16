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

## Aufgabe 5: Nutzungs-Limit alle 60 s fürs Dashboard bereitstellen (#113)

Erst nach Aufgabe 4. Der Nutzer hat zugestimmt. Trotzdem jede Änderung an seinen Einstellungsdateien vorher kurz zeigen und bestätigen lassen; nichts überschreiben, sondern bestehende Einstellungen ergänzen.

**Hintergrund:** Das Dashboard „Entwicklungsstand live“ (https://claude.ai/artifact/Smc3PMAsNzSgMnFG2WHqK2) soll den Verbrauch des 5-Stunden- und des Wochenlimits alle 60 s zeigen.
- Der Connector „Claude Code Remote“ ist für Seiten gesperrt.
- Offiziell dokumentiert ist aber: Claude Code übergibt dem **Status-Line-Script** `rate_limits.five_hour.used_percentage`, `rate_limits.five_hour.resets_at`, `rate_limits.seven_day.used_percentage` und `rate_limits.seven_day.resets_at` (siehe https://code.claude.com/docs/en/statusline, Abschnitt „Available data“ / „Rate limit usage“). Mit `refreshInterval` läuft das Script im festen Takt.

**Teil A – Status-Line-Script (in deiner eigenen Claude-Code-Installation auf dem PC)**
1. Lege `C:\Users\maxim\.claude\usage-statusline.mjs` an, ein Node-Script ohne Abhängigkeiten, weil `jq` unter Windows meist fehlt. Es
   - liest das JSON von stdin;
   - schreibt `C:\Users\maxim\.claude\usage\usage.json`, und zwar atomar (erst in eine temporäre Datei, dann umbenennen). Inhalt:
     ```json
     {"at":"<ISO-Zeit>","five_hour":{"used_percentage":63,"resets_at":1792170600},
      "seven_day":{"used_percentage":8,"resets_at":1792238400},
      "history":[{"at":"…","five_hour":63}]}
     ```
     - Fehlt ein Fenster im Input, bleibt der alte Wert stehen (laut Doku kann ein Fenster einzeln fehlen).
     - `history` behält höchstens die letzten 300 Punkte und nur einen Punkt pro Minute.
     - Keine anderen Daten (kein Transcript, keine Pfade, keine Session-Inhalte).
   - gibt eine kurze Status-Zeile aus, z. B. `5h 63 % · Woche 8 %`. Wenn es schon eine Status-Line gab, deren Ausgabe beibehalten.
2. In `C:\Users\maxim\.claude\settings.json` `statusLine` setzen bzw. ergänzen:
   ```json
   {"type":"command","command":"node C:/Users/maxim/.claude/usage-statusline.mjs","refreshInterval":60}
   ```
   Vorher zeigen, was dort steht.
3. Prüfen, dass die Datei `usage.json` entsteht und sich aktualisiert, nachdem du eine Antwort gegeben hast.

**Teil B – Lese-Zugang für das Dashboard über die Claude-Desktop-App**
- Das Dashboard kann einen lokalen MCP-Server auf dem PC des Nutzers aufrufen (`host:<name>`), wenn es in der Claude-Desktop-App geöffnet wird.
- Richte dafür in der Konfiguration der Claude-Desktop-App einen Server namens `usage` ein (Datei `claude_desktop_config.json` der Desktop-App; den genauen Ort bitte selbst prüfen und dem Nutzer zeigen). Am besten mit dem offiziellen Filesystem-Server, `npx -y @modelcontextprotocol/server-filesystem C:\Users\maxim\.claude\usage`.
- **Nur dieser eine Ordner** wird freigegeben, nichts anderes.
- Der Nutzer muss die Desktop-App danach neu starten.
- Berichte mir den **genauen Namen des Lese-Tools**, z. B. `read_text_file` oder `read_file`, und dessen Argumente, damit ich das Dashboard darauf umstelle.

**Fertig, wenn**
- `usage.json` sich nach Antworten aktualisiert,
- der MCP-Server in der Desktop-App eingetragen ist,
- du mir per Nachricht berichtet hast: Pfade, Inhalt einer Beispiel-`usage.json`, Server-Name, Tool-Name und Argumente, und was der Nutzer noch tun muss.

Keine Zugangsdaten oder Tokens anfassen, keine undokumentierten Schnittstellen nutzen. Kein Commit ins Repo nötig.
