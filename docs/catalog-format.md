# Produktlisten importieren (echte Möbel, z. B. IKEA Österreich / Möbelix)

## Recherche: Gibt es offizielle Schnittstellen? (Stand Oktober 2026)

* **IKEA:** Es gibt keine offiziell dokumentierte, öffentliche Produkt-API für Drittentwickler.
  Verfügbare Zugriffe (z. B. das Python-Paket `ikea_api`) sind von der Community
  rekonstruierte, inoffizielle Schnittstellen des Webshops.
  Diese werden hier **nicht** verwendet: Nutzung ist nicht ausdrücklich erlaubt und kann jederzeit brechen.
* **Möbelix (Österreich):** Keine öffentliche API-Dokumentation gefunden. Ein Affiliate-Programm
  (über ein Partnernetzwerk) mit Produktdaten-Feed wurde gelistet, der Eintrag war aber als
  „geschlossen“ markiert. Ein solcher Feed wäre die sauberste Quelle – er setzt eine Partnerschaft voraus.
* **Scraping** der Webseiten wird bewusst nicht umgesetzt (Nutzungsbedingungen, Urheberrecht,
  Schutzmaßnahmen, keine Stabilität).

**Konsequenz:** Die App funktioniert vollständig mit dem generischen Katalog (typische Maße,
klar als *Schätzung* markierte Richtpreise). Echte Produkte werden über eine **vom Nutzer
erstellte Produktliste** importiert (Name, Maße, Preis, Link vom Produktblatt übernommen).
Eine spätere Feed-Anbindung (Affiliate/Partner) kann als eigener Adapter ergänzt werden,
ohne den Kern zu ändern – importierte Einträge haben dieselbe Struktur (`src/catalog/types.ts`).

Preise aus Produktlisten werden als **„eigene Angabe“** mit Datum gespeichert, nie als „bestätigt“.
Verfügbarkeit/Lagerstand wird nicht angezeigt, weil es dafür keine verlässliche Quelle gibt.

## CSV-Format

Trennzeichen `;` oder `,` (automatisch erkannt), UTF-8, erste Zeile = Spaltennamen.
Dezimalkomma erlaubt. Pflichtspalten: `name`, `breite_cm`, `tiefe_cm`, `hoehe_cm`.

```csv
name;kategorie;breite_cm;tiefe_cm;hoehe_cm;preis_eur;preisdatum;marke;haendler;url;artikelnummer
Sofa 3-Sitzer Beispiel;sofa;218;88;83;499,00;2026-10-01;IKEA;IKEA Österreich;https://www.ikea.com/at/de/p/...;123.456.78
```

Weitere optionale Spalten: `bild_url`, `farbe` (`#rrggbb`), `form` (prozedurale Form, z. B. `sofa`,
`bed`, `table`, `wardrobe`, `shelf`, `k-base`), `modell_url` (GLB/glTF-Modell, https).
Kategorien: `sofa, bed, table, chair, storage, desk, lighting, textile, kitchen, appliance, bathroom, decor`.

## JSON-Format

```json
{
  "format": "wohnungsplaner-catalog",
  "version": 1,
  "name": "Meine Auswahl",
  "units": "cm",
  "items": [
    { "name": "Regal", "category": "storage", "width": 80, "depth": 28, "height": 202,
      "price": 59.99, "priceDate": "2026-10-01", "retailer": "IKEA Österreich",
      "productUrl": "https://www.ikea.com/at/de/p/...", "shape": "shelf" }
  ]
}
```

Nur `http(s)`-Links werden übernommen. Importierte Listen werden lokal (IndexedDB) gespeichert.

## 3D-Modelle mitliefern (`modelFile`)

Ein Listeneintrag kann mit `"modelFile": "10409932.glb"` (nur Dateiname, Endung `.glb`) auf eine
GLB-Datei verweisen. Am einfachsten im Katalog **„Ordner importieren (z. B. ikea-import)…“** wählen
und den ganzen Ordner angeben; alternativ im Dateidialog die Liste und die .glb-Dateien gemeinsam
markieren (Mehrfachauswahl). Andere JSON-Dateien im Ordner (z. B. `bericht.json`) werden
übersprungen. Wurde nur die Liste importiert, lassen sich die .glb-Dateien später über
„Produktliste importieren…“ allein auswählen – sie werden den importierten Produkten zugeordnet, die
sie per `modelFile` nennen und noch kein Modell haben. Jede Datei wird geprüft (gültiges glTF, ladbar, Maße); die Maße der
Liste bleiben maßgeblich (das Modell wird darauf skaliert). Bei Abweichungen über 10 % oder
vertauschter Breite/Tiefe erscheint ein Hinweis; fehlende oder ungültige Dateien → maßstäbliche
Näherung. (Nur JSON; CSV unterstützt `modell_url`, aber keine mitgelieferten Dateien.)

## Hilfsskript: IKEA-Artikelnummern → Produktliste

```bash
node scripts/ikea-products.mjs "104.099.32, 2x 106.230.36, S895.792.19" --models --out ikea-import
# Text-/Listen-Datei statt Argument ebenfalls möglich; max. 25 (höchstens 50) Artikel pro Lauf
```

Ruft je Artikel die **öffentliche** Produktseite `https://www.ikea.com/at/de/p/-<Nummer>/` ab
(1,5 s Abstand), liest deren schema.org-Daten mit dem Parser der App und schreibt
`produktliste.json` + `bericht.json`; mit `--models` zusätzlich die von der Seite deklarierte
GLB-Datei (`web-api.ikea.com/dimma/assets`, laut robots.txt erlaubt). Keine Suche, keine Konten,
keine internen IKEA-APIs. Modelle/Bilder nur privat nutzen; der Ordner `ikea-import/` ist in
`.gitignore`. Hinter einem Proxy (z. B. Cloud-Umgebung): `NODE_USE_ENV_PROXY=1` setzen.


## Multipacks

Optionales Feld `packSize` (CSV: `stueck_pro_packung`, ganze Zahl ≥ 2): Stück pro Packung. `price` ist dann der Preis der ganzen Packung; Budget und Einkaufsliste rechnen mit aufgerundeten Packungen. Fehlt das Feld, gilt 1.
