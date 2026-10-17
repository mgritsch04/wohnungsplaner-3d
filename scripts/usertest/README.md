# Automatische Vorprüfung von User-Tests

Klickt die Schritte eines `[USERTEST]`-Issues automatisch in Chromium durch, macht pro Schritt
einen Screenshot, vergleicht Erwartung und Ergebnis und fällt ein Urteil. Ablauf, Markierung im Issue
und PC-Sitzung: [`docs/DEVELOPMENT_WORKFLOW.md`](../../docs/DEVELOPMENT_WORKFLOW.md) › „Automatische User-Tests“.

```bash
node scripts/usertest/run.mjs 178               # baut die App, eigener Port 4180
node scripts/usertest/run.mjs 178 --no-build    # vorhandenes dist/ verwenden
node scripts/usertest/run.mjs 178 --report-only # nur Bericht aus report.json neu erzeugen
node scripts/usertest/run.mjs 166 --gpu         # auf einem PC: echte Grafikkarte statt Software-Grafik
node scripts/usertest/run.mjs 166 --plan        # nur ausgeben, wo der Test laufen muss: cloud | pc
node scripts/usertest/run.mjs 166 --report-only --report-url <link>  # Link zum Bildbericht in report.md
```

Urteil (`report.json` › `verdict`, Konsole, Kopf von `report.md`):

| Urteil | Wann | Folge |
|---|---|---|
| `bestanden` | alle Schritte `ok` (optional `skip`), keine Konsolenfehler, kein `realDevice`, bei `pc: true` mit echter Grafikkarte | „Automatisch BESTANDEN“, Issue als bestätigt markieren |
| `pc` | kein Fehler, aber `pc: true` und ohne echte Grafikkarte gelaufen | auf dem PC mit `--gpu` wiederholen, nichts ins Issue |
| `pruefen` | alles andere (Abweichung, `look`, `device`, `realDevice`) | Kommentar „bitte selbst anschauen“ mit der Liste |

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

Was nur auf einem echten Gerät (iPhone) prüfbar ist, gehört zusätzlich in `realDevice`.
`pc: true` setzen, wenn ein Schritt die 3D-Optik beurteilt (Material, Licht, Realismus); dann zählt nur ein Lauf mit `--gpu`.
Hilfen im Schritt (`t`): `freshStart()`, `project()`, `selection()`, `furniture(pred)`, `planToScreen()`,
`worldToScreen()`, `lookAt(position, target)` (3D-Kamera), `touch(from[], to[])` (Finger), `poll(fn)`, `shot(caption)`.
