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
