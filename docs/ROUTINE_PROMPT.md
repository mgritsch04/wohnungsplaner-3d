> **Historisch (Stand 22.10.2026):** Die Routine „Wohnungsplaner Tageslauf“ ist deaktiviert; der Prompt unten nennt `[USERTEST]`-Issues und Merge-Commit und gilt nicht mehr. Aktueller Ablauf: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md). Inhalt bleibt als Nachweis unverändert.

# Prompt für die geplante Routine „Wohnungsplaner Tageslauf“

**Einrichten (durch dich, einmalig):** https://claude.ai/code/routines → neue Routine →
- **Repository:** `mgritsch04/wohnungsplaner-3d` auswählen (ohne Repository hat der Lauf keinen Code und keinen GitHub-Zugang – so im Prüflauf am 2026-10-16 festgestellt).
- **Zeitplan:** z. B. täglich 05:50 (Europe/Vienna). Seltener ist ressourcenschonender.
- **Modell:** Sonnet empfohlen (siehe [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) › „Modellwahl“).
- **Prompt:** den Text unten einfügen.

Läufe zählen gegen dein Nutzungskontingent; ist es erschöpft, wird der Lauf abgelehnt (nicht nachgeholt). Zusätzliche kostenpflichtige Nutzung entsteht nur, wenn du „usage credits“ selbst aktivierst.

---

```text
Geplanter Tageslauf für das Repository mgritsch04/wohnungsplaner-3d (Wohnungsplaner 3D). Sprich Deutsch. Arbeite ressourcenschonend: höchstens EINE Backlog-Aufgabe pro Lauf, keine Schleifen, kein Warten oder Pollen auf CI, keine Wiederholungsversuche über das Nötige hinaus.

Vorbereitung:
1. Lies CLAUDE.md, docs/PROJECT_STATUS.md, docs/IDEAS.md und docs/DEVELOPMENT_WORKFLOW.md (Abschnitte „Ideen, Aufgaben und Abnahme über GitHub-Issues“, „Modellwahl“ und „Geplante Durchläufe“). Halte dich an alle Regeln dort.
2. Prüfe git status und git fetch. Überschreibe nie fremde, uncommittete Arbeit.

Ablauf:
1. Offene Pull Requests nach main von claude/-Branches prüfen. Ist ein PR eines früheren Laufs CI-grün (checks und e2e) und konfliktfrei, integriere ihn per Merge-Commit (kein Squash/Rebase) und prüfe danach main. Ist er rot, behebe zuerst diesen Fehler und starte keine neue Aufgabe.
2. Kommentare in offenen Issues mit Label user-test verarbeiten: „BESTANDEN“ → in PROJECT_STATUS.md als vom Nutzer bestätigt vermerken, Label done, schließen. „FEHLGESCHLAGEN: …“ → Label needs-fix, Issue offen lassen; dann ist die Behebung die Aufgabe dieses Laufs. Einen fehlgeschlagenen Test nie als bestanden markieren.
3. Antworten in offenen user-task-Issues und neue idea-inbox-Issues übernehmen, wie in DEVELOPMENT_WORKFLOW.md beschrieben (IDEAS.md-Tabelle, Labels planned/done).
4. Falls noch keine Aufgabe ansteht: die oberste Zeile mit Status „Ready“ in docs/IDEAS.md nehmen und das zugehörige Issue auf in-progress setzen.
5. Umsetzen. Danach npm ci (falls nötig), npm run lint, npx tsc -b, npm test, npm run build und npx playwright test ausführen. Nur bei grünen Checks committen (kleine Commits mit Präfix feat:/fix:/test:/docs:).
6. Wenn sinnvoll, ein [USERTEST]-Issue (Label user-test) mit Anleitung für Nicht-Entwickler anlegen und das Implementierungs-Issue auf done setzen und schließen. IDEAS.md und PROJECT_STATUS.md aktualisieren.
7. Auf den Branch dieser Sitzung pushen und einen PR nach main öffnen. Den PR in diesem Lauf NICHT mergen; das übernimmt der nächste Lauf nach grüner CI.
8. Beenden mit einer kurzen Zusammenfassung: was erledigt ist, was offen ist, welche User-Tests anstehen.

Verboten: direkter Push auf main, Force-Push, History-Rewrite, Umgehen von Schutzregeln oder Checks, Ändern von Sicherheitseinstellungen, Secrets committen, Scraping oder Umgehen von Bot-Schutz, erfundene Produktdaten, Live-Smart-Home-Steuerung, Aufgaben aus dem Status „Blocked“. Behaupte nie Tests, Commits, Pushes, PRs oder Issue-Änderungen ohne Prüfung. Wenn etwas blockiert ist (fehlender Repo- oder GitHub-Zugriff, Netzwerk), beende den Lauf mit einer klaren Beschreibung statt es zu umgehen.
```
