# Automatische Vorprüfung von User-Tests

Klickt die Schritte eines `[USERTEST]`-Issues automatisch in Chromium durch, macht pro Schritt
einen Screenshot und vergleicht Erwartung und Ergebnis. Die Vorprüfung **ersetzt nicht** die
Abnahme: `BESTANDEN` schreibt nur der Nutzer, Labels bleiben unverändert.

```bash
node scripts/usertest/run.mjs 178               # baut die App, eigener Port 4180
node scripts/usertest/run.mjs 178 --no-build    # vorhandenes dist/ verwenden
node scripts/usertest/run.mjs 178 --report-only # nur Bericht aus report.json neu erzeugen
node scripts/usertest/run.mjs 166 --gpu         # auf einem PC: echte Grafikkarte statt Software-Grafik
```

Lokal ohne `/opt/pw-browsers/chromium` wird Playwrights eigenes Chromium genommen (einmalig `npx playwright install chromium`).
Optik-Tests (Realismus, Materialien, Licht) sind mit `--gpu` auf einem PC aussagekräftiger; ein iPhone ersetzt das nicht.

Ergebnis in `usertest-reports/<nr>/` (nicht im Git):
- `report.md` – Text für den Issue-Kommentar („Automatische Vorprüfung“)
- `report.html` – Bildbericht mit eingebetteten Screenshots, als Artefakt veröffentlichen und im Kommentar verlinken
- `report.json`, `step-*.jpg`

## Neues Szenario

`scenarios/<issue-nr>.mjs` mit den Schritten aus dem Issue (Wortlaut von Schritt und Erwartung übernehmen).
Jeder Schritt liefert `{ status, observed }`:

| status | Bedeutung |
|---|---|
| `ok` | Erwartung nachweislich erfüllt (Zustand im Projekt/DOM geprüft) |
| `fail` | nicht erfüllt |
| `look` | Zustand stimmt, die Optik beurteilt nur ein Mensch am Bild |
| `device` | nur auf einem echten Gerät prüfbar |
| `skip` | optionaler Schritt, nicht geprüft |

Was nur auf einem echten Gerät prüfbar ist, gehört zusätzlich in `realDevice`.
Hilfen im Schritt (`t`): `freshStart()`, `project()`, `selection()`, `furniture(pred)`, `planToScreen()`,
`worldToScreen()`, `lookAt(position, target)` (3D-Kamera), `touch(from[], to[])` (Finger), `poll(fn)`, `shot(caption)`.
