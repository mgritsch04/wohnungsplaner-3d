# IKEA-Planung als JSON speichern und mit Namen + Preisen importieren

_Stand 2026-10-16. Gilt für den IKEA-Österreich-**PAX-/Aufbewahrungsplaner** (anonyme Planung mit „Planungscode“). Den Küchenplaner (METOD) unterstützt die App nicht (siehe [`PLANNER_IMPORT_RESEARCH.md`](PLANNER_IMPORT_RESEARCH.md))._

Kurz: Aus der Planung entsteht im Wohnungsplaner ein Raum mit den Korpussen an den geplanten Stellen. Ohne weitere Datei haben die Korpusse nur Maße und Artikelnummern. Mit der **Produktliste** (Schritt 3) tragen sie die echten IKEA-Namen und zeigen im Budget Preise.

**Der bisherige Weg „GLB herunterladen und importieren“ (Katalog › Produktliste importieren) bleibt unverändert** und ist unabhängig von dieser Anleitung.

> Hinweis zur Prüfung: Die Schritte 1–2 beschreiben allgemeine Browser-Werkzeuge. Ich konnte sie hier nicht mit Bildschirmfotos belegen; die Bezeichnungen der Menüs können je nach Browser und Sprache abweichen. Schritt 3–4 wurden mit echten IKEA-Produktseiten und einer echten Testplanung ausprobiert (siehe unten „Was geprüft ist“).

## Was du brauchst
* Eine Planung im IKEA-PAX-Planer, die du selbst erstellt hast (Planungscode oder Link der Form `…/pax/web/latest/at/de/#/u/<CODE>`).
* Einen Computer mit Chrome, Edge oder Firefox.
* Für Schritt 3: [Node.js](https://nodejs.org) und eine Kopie dieses Projekts (Ordner „wohnungsplaner-3d“, einmal `npm ci` ausgeführt). Schritt 3 ist optional – ohne ihn bleiben Namen und Preise leer.

## Schritt 1: Planung öffnen
1. Öffne deine Planung im IKEA-PAX-Planer (über den gespeicherten Link bzw. Planungscode). Falls die Planung noch nicht gespeichert ist: im Planer auf **„Zusammenfassung“** gehen – dabei legt der Planer die Planung unter einem Planungscode ab.
2. Warte, bis die Planung vollständig angezeigt wird.

## Schritt 2: Die Planungsdaten (JSON) aus dem Browser kopieren
Der Planer lädt deine Planung als Datei vom IKEA-Server. Diese Datei brauchst du.
1. Drücke **F12** (Entwicklerwerkzeuge). Wähle den Reiter **Netzwerk** (Chrome/Edge: „Network“).
2. Lade die Seite neu (**F5**), damit die Anfragen aufgezeichnet werden.
3. Tippe in das Filterfeld des Netzwerk-Reiters `configurations`.
4. Suche die Anfrage, deren Adresse **mit deinem Planungscode endet** (z. B. `…/configurations/retailunit/AT/locale/de-AT/343J5TD`) und die mit **GET** und Status **200** geladen wurde. Klicke sie an.
5. Öffne den Reiter **Antwort** („Response“). Du siehst Text, der mit `{"configurationId":"…` beginnt.
6. Kopiere die gesamte Antwort: Rechtsklick auf die Anfrage › **Kopieren › Antwort kopieren** (Chrome/Edge: „Copy › Copy response“); in Firefox im Reiter „Antwort“ den Text markieren (Strg+A) und kopieren.
7. Öffne einen Texteditor (Notepad/Editor, nicht Word), füge den Text ein und speichere ihn als `planung.json` (Dateityp „Alle Dateien“, Kodierung UTF-8).

Prüfen: Die Datei enthält die Wörter `itemList` und `articles`. Wenn nicht, war es die falsche Anfrage – probiere eine andere mit dem Planungscode in der Adresse.

Es werden nur **deine eigenen** Planungsdaten gespeichert, kein Konto und keine Zugangsdaten. Die App ruft IKEA-Dienste nicht selbst auf.

## Schritt 3 (optional, empfohlen): Produktliste mit Namen und Preisen erzeugen
Im Projektordner, in einer Eingabeaufforderung/einem Terminal:

```
node scripts/ikea-products.mjs --plan planung.json --out ikea-import
```

(Pfad zu `planung.json` ggf. anpassen. Hinter einem Firmen-/Cloud-Proxy zusätzlich die Umgebungsvariable `NODE_USE_ENV_PROXY=1` setzen.)

Das Skript liest die Artikelnummern aus deiner Planung und ruft für **jede verschiedene Nummer genau eine öffentliche IKEA-Produktseite** ab (eine Anfrage alle 1,5 Sekunden, höchstens 50 Artikel pro Lauf). Es entsteht `ikea-import/produktliste.json` (plus `bericht.json` mit Hinweisen zu übersprungenen Artikeln). Bei Fehlern wie „HTTP 403/429“ beendet es nicht, sondern überspringt den Artikel – blockiert IKEA, wird das nicht umgangen: später erneut versuchen.

Die Produktliste enthält Name, Preis und Maße laut IKEA-Seite und das Datum des Abrufs. Sie ist für deine private Nutzung gedacht – nicht weitergeben oder veröffentlichen.

## Schritt 4: In den Wohnungsplaner importieren
1. Wohnungsplaner öffnen, links den Reiter **Import** wählen.
2. Auf **„IKEA-Planung (JSON) importieren…“** klicken.
3. Im Dateidialog **beide Dateien gemeinsam** markieren (Strg-Taste gedrückt halten bzw. mit der Maus aufziehen): `planung.json` und `produktliste.json`. Nur `planung.json` zu wählen geht auch – dann ohne Namen und Preise.
4. Die Meldung nennt, wie viele Korpusse Namen und Preise bekamen, und weist auf Lücken hin.

## Wie Namen und Preise zugeordnet werden
* Zuordnung ausschließlich über die **IKEA-Artikelnummer** (8 Ziffern, ohne Punkte).
* **Name** = Name des Korpus laut Produktliste (z. B. „PAX Korpus …“), dahinter eine Kurzliste der Einbauteile (Böden, Stangen …).
* **Preis** eines Korpus = Preis des Korpus **plus** Preise seiner Einbauteile (Böden, Schubladen, Stangen …), jeweils laut Produktliste. Der Preis wird als „eigene Angabe“ mit Abrufdatum gespeichert, nie als „bestätigt“ (wie bei jeder importierten Produktliste).
* Fehlt für ein Einbauteil der Preis, wird der Korpus-Preis als **Schätzwert** markiert und die Meldung nennt die fehlenden Artikelnummern. Fehlt der Korpus selbst, bleibt er wie bisher („PAX Korpus 604.582.13 …“, ohne Preis).
* Die IKEA-Stückliste enthält auch Teile ohne eigene Position im Plan (z. B. Türen, Scharniere). Sie lassen sich keinem Korpus zuordnen und stehen **nicht im Budget**; die Meldung nennt Anzahl und – soweit bekannt – die Summe.
* Die 3D-Darstellung bleibt ein maßgenauer Quader (Näherung); echte Korpus-Modelle sind damit nicht verbunden.

## Was geprüft ist
* Automatisiert (Unit + E2E) mit einer **synthetischen** Produktliste (erfundene Namen und Preise, nur Artikelnummern der Testplanung) – siehe `src/catalog/providers/fixtures/ikea-pax-products.synthetic.json`.
* Echter Abruf der 16 Artikel der Testplanung von den öffentlichen IKEA-Österreich-Produktseiten am 2026-10-16: alle 16 lieferten Name, Maße und Preis. Diese Daten liegen **nicht** im Repository.
* Nicht geprüft: das Aussehen der IKEA-Planer-Oberfläche und der Browser-Menüs (Schritt 1–2); andere Planer als PAX.
