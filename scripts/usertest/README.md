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
node scripts/usertest/run.mjs 166 --report-only --image-base <url>  # Bildlinks zu offenen Schritten in report.md
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
- `report.md` – Text für den Issue-Kommentar. Bei „bestanden“ reicht der Text. Bei offenen Schritten
  (Fehlschlag, „am Bild beurteilen“, echtes Gerät) nennt er deren Screenshots: zum Anhängen an den Kommentar
  oder mit `--image-base <url>` als Bildlinks.
- `report.html` – alle Screenshots eingebettet, nur zum lokalen Ansehen. **Nicht** als Artefakt veröffentlichen
  (Regel von G, 2026-10-17).
- `report.json`, `step-*.jpg`

## Welche Tests anstehen

```bash
node scripts/usertest/issues.mjs       # Warteschlange: Label auto-user-test, dazu alte [USERTEST]-Issues
node scripts/usertest/issues.mjs 178   # Testschritte eines Issues als JSON (Vorlage fürs Szenario)
```

- **Neues Modell:** Das Feature-Issue trägt das Label `auto-user-test`; die Testschritte stehen im neuesten Kommentar,
  der mit `## Testschritte` oder `**Testschritte**` beginnt (nummerierte Schritte, je eine Zeile `→ Erwartet: …`,
  optionale Schritte mit `Optional:`).
- **Altes Modell:** eigenes `[USERTEST]`-Issue, Schritte im Issue-Text. Funktioniert weiter.
- Die Liste zeigt pro Issue: Cloud oder PC, ob ein Szenario fehlt, ob der Test schon automatisch geprüft wurde
  und ob sich die Schritte seitdem geändert haben. Das Skript liest nur; Kommentar, Labels und Schließen
  erledigt die Session mit ihren GitHub-Werkzeugen. Was zu tun ist, steht nach jedem Lauf in
  `report.json` › `actions` und auf der Konsole:

| | `bestanden` | `pruefen` |
|---|---|---|
| Feature-Issue (`auto-user-test`) | Kommentar, `auto-user-test` → `done`, schließen | Kommentar, `auto-user-test` → `user-test` |
| altes `[USERTEST]`-Issue | Kommentar, `user-test` → `done`, schließen, Feature-Issue abschließen | Kommentar, `user-test` bleibt |

Bei `pc` wird nichts ins Issue geschrieben, der Lauf wird auf dem PC mit `--gpu` wiederholt.

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
