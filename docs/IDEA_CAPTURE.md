# Ideen erfassen (Neben-Session, z. B. am Handy)

Diese Anleitung ist für eine **zweite Claude-Session**, die nur Ideen aufnimmt. Die Entwicklung macht ausschließlich die Hauptsession (siehe [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md)).

## Erlaubt
- Neues GitHub-Issue im Repository `mgritsch04/wohnungsplaner-3d` anlegen, Titel mit `[IDEE] `, Label **`idea-inbox`**.
- Offene `idea-inbox`-Issues per Kommentar ergänzen.
- Vorher nach ähnlichen offenen Issues suchen und ggf. dort ergänzen statt neu anlegen.

## Nicht erlaubt
- Dateien im Repository ändern, Branches/Commits/PRs anlegen.
- `docs/IDEAS.md` bearbeiten (pflegt nur die Hauptsession).
- Labels anderer Issues ändern, Issues schließen, User-Test-Issues beantworten (das machst du selbst mit `BESTANDEN` / `FEHLGESCHLAGEN: …`).

## Inhalt eines Ideen-Issues
- **Was soll besser werden?** (1–3 Sätze, gern mit Beispiel)
- **Warum / wofür?**
- optional: **Woran merke ich, dass es fertig ist?**, Dringlichkeit (hoch/mittel/niedrig), Screenshot-Beschreibung.

## Vorlage zum Kopieren in die Neben-Session
> Du hilfst mir nur beim Erfassen von Ideen für das Projekt `mgritsch04/wohnungsplaner-3d`. Lege für jede Idee ein GitHub-Issue mit Titel „[IDEE] …“ und Label `idea-inbox` an (Abschnitte: Was soll besser werden? / Warum? / Woran merke ich, dass es fertig ist? / Dringlichkeit). Suche vorher nach ähnlichen offenen Issues und ergänze dort per Kommentar, statt Duplikate anzulegen. Ändere keine Dateien, Branches, PRs oder Labels anderer Issues und schließe keine Issues. Antworte auf Deutsch.

Die Hauptsession übernimmt neue Ideen beim nächsten Durchlauf in `docs/IDEAS.md` und setzt das Label auf `planned`.
