# Integration echter Produkte: IKEA Österreich & Möbelix Österreich

_Stand: 2026-10-16. Kennzeichnung: `VERIFIED` (selbst geprüft) · `PARTIALLY VERIFIED` · `UNVERIFIED` (nur aus Sekundärquellen) · `UNAVAILABLE` (Test nicht möglich)._

## Kurzfazit
- Für **keinen** der beiden Händler gibt es eine offiziell dokumentierte, öffentliche Produkt-API. (`UNVERIFIED` – Recherche, keine Herstellerbestätigung)
- **Live-Tests waren in der Entwicklungsumgebung nicht möglich:** Die Cloud-Umgebung blockiert `www.ikea.com` und `www.moebelix.at` (`UNAVAILABLE`).
- **Umgesetzt:** Provider-Architektur mit normalisiertem Produktmodell und ein End-to-End-Proof-of-Concept „Produkt von Händlerseite übernehmen“: Der Nutzer fügt Produkt-URL und selbst kopierten Seitenquelltext ein, die App liest schema.org-Produktdaten (JSON-LD) und Maßangaben aus. Nichts wird vom Händler abgerufen, nichts geschätzt. (`VERIFIED` mit **synthetischen** Testseiten; mit echten Seiten `NEEDS USER TEST`)

## 1. Untersuchte Quellen

| Quelle | Ergebnis | Status |
|---|---|---|
| Offizielle IKEA-Entwicklerdoku / öffentliche API | Nicht gefunden. API Evangelist führt für IKEA keine offizielle öffentliche API; gelistete Schnittstellen sind von der Community rekonstruiert. [Quelle](https://providers.apievangelist.com/providers/ikea/) | UNVERIFIED |
| `ikea_api` (PyPI) | Inoffizieller Client für Webshop-Endpunkte (Suche, Artikelinfo, 3D-Modelle, Lager); Autor beschreibt erschwerte Authentifizierung. [Quelle](https://pypi.org/project/ikea-api) | UNVERIFIED – bewusst **nicht** genutzt |
| IKEA Knowledge Hub (API-Services) | Endpunkte auf intern wirkender Domain, Zugang für Dritte unklar. [Quelle](https://ingress.prod.knowledge.ikea.net/services) | UNVERIFIED |
| Kommerzielle Dritt-APIs/Scraper (Apify, Zyla …) | Bieten IKEA-Daten per Scraping an; erlauben laut eigenen Beispielen Rückschlüsse, dass Produktseiten schema.org-Offers enthalten. [Beispiel](https://apify.com/e-commerce/ikea-product-scraper.md) | UNVERIFIED – nicht genutzt (keine Berechtigung des Händlers belegt) |
| Möbelix-API-Dokumentation | Nicht gefunden. | UNVERIFIED |
| Möbelix-Affiliate-Programm | Eintrag nennt Produktdaten-Feed mit Deeplinks, Status „Closed“. [Quelle](https://affi.io/m/mobelix-kost-fast-nix-online-shop) | UNVERIFIED |
| Nutzungsbedingungen ikea.com/at, moebelix.at | Nicht abrufbar (siehe 3.) | UNAVAILABLE |

## 2. Kandidaten für eine Integration
1. **Partner-/Affiliate-Feed** (bevorzugt, rechtlich sauber) – erfordert Anmeldung/Vertrag beim Händler bzw. Netzwerk.
2. **Strukturierte Daten von Produktseiten, vom Nutzer selbst kopiert** (umgesetzt) – kein automatisierter Zugriff der App.
3. **Produktlisten (CSV/JSON)** vom Nutzer (umgesetzt, siehe `catalog-format.md`).
4. Inoffizielle Endpunkte / Scraping – **abgelehnt** (keine Erlaubnis, instabil, ggf. AGB-Verstoß).

## 3. Durchgeführte Tests und beobachtete Ergebnisse

| Test (2026-10-16) | Ergebnis | Status |
|---|---|---|
| `curl https://www.ikea.com/robots.txt` aus der Cloud-Umgebung | Proxy verweigert CONNECT (HTTP 403, „connect_rejected“) | UNAVAILABLE |
| `curl https://www.moebelix.at`, `https://api.ingka.ikea.com` | Keine Verbindung (Status 000) | UNAVAILABLE |
| Web-Abruf-Werkzeug auf `www.ikea.com/robots.txt` und `www.moebelix.at/robots.txt` | DNS-Fehler `ENOTFOUND` | UNAVAILABLE |
| CORS bei direktem Browser-Abruf der Produktseiten | nicht testbar (s. o.); erfahrungsgemäß senden Shops keine CORS-Freigabe – direkter Abruf aus der App ist daher ohnehin nicht vorgesehen | UNVERIFIED |
| Parser für schema.org Product/Offer/ProductGroup/@graph, QuantitativeValue (MMT/CMT/MTR), deutsche Maßzeilen („Breite: 80 cm“, „Maße: 200 x 90 x 82 cm“) | 7 Unit-Tests grün | VERIFIED (synthetische Seiten) |
| E2E: Seite einfügen → auslesen → Katalog → im Plan platzieren; Fehlerfall „keine Produktdaten“ hält die App bedienbar | Playwright grün | VERIFIED (synthetische Seite) |

## 4./5. Abrufbare Felder und Maße
Der Parser übernimmt, **sofern auf der Seite vorhanden**: Name, SKU/Artikelnummer (bei IKEA zusätzlich aus der URL, Format `XXX.XXX.XX`), Marke, Preis + Währung (nur mit Währungsangabe), Bild-URL (nur http/https), Verfügbarkeit (wörtlich), Variante/Farbe, Breite/Tiefe/Höhe.
Ob echte IKEA- oder Möbelix-Seiten diese Felder tatsächlich so liefern, konnte nicht geprüft werden (`UNAVAILABLE`). Fehlende Maße werden als „fehlt“ markiert und müssen eingetragen werden; geänderte Werte gelten als manuell.

## 6. Bilder und 3D-Modelle
Nicht geladen (`UNAVAILABLE`). Händlerbilder und -3D-Modelle sind urheberrechtlich geschützt; die App speichert nur Links. Eigene oder lizenzierte GLB/glTF-Modelle können pro Objekt hochgeladen werden.

## 7. Einschränkungen
- Zugriff: Cloud-Netzwerkrichtlinie blockiert beide Domains. Freigabe: Umgebungseinstellungen → Network access → Allowed domains `www.ikea.com`, `www.moebelix.at`.
- Authentifizierung/API-Schlüssel: keine öffentliche Registrierung bekannt.
- Rechtliches: AGB nicht eingesehen (nicht abrufbar). Bis zur Klärung keinerlei automatisierter Abruf.
- Preise/Verfügbarkeit sind zeitabhängig; gespeichert wird das Datum. Aktualisierung = Seite erneut einfügen.

## 8. Produktionsreife
| Weg | Bewertung |
|---|---|
| Nutzer fügt Seite ein (PoC) | einsatzbereit für private Planung; abhängig vom Markup der Händler (kann sich ändern) |
| Produktlisten CSV/JSON | einsatzbereit |
| Partner-Feed | nicht verfügbar ohne Vertrag |
| Inoffizielle API/Scraping | nicht zulässig/ungeeignet |

## 9. Empfehlung
Kurzfristig: eingefügte Produktseiten + Produktlisten (umgesetzt). Langfristig: Partner-/Affiliate-Feed anfragen und als weiteren Provider in `src/catalog/providers/` anbinden (Feed über eigenen Server, nicht im Browser).

## 10. Nächste Schritte (brauchen dich)
1. Netzwerkfreigabe für `www.ikea.com` und `www.moebelix.at` in der Cloud-Umgebung, falls ich Struktur und robots.txt/AGB selbst prüfen soll.
2. Praxistest: eine echte IKEA- und eine Möbelix-Produktseite im Dialog einfügen und melden, ob Name/Preis/Maße stimmen.
3. Entscheidung, ob eine Partnerschaft/Affiliate-Anmeldung angestrebt wird.

## Architektur
`src/catalog/providers/types.ts` (normalisiertes Modell mit Feldstatus `source`/`user`/`missing`, Abrufzeitpunkt, Qualität, Lizenzhinweis) · `registry.ts` (Händler, Hosts, Live-Status, Artikelnummer aus URL) · `structuredData.ts` (Parser) · `toCatalog.ts` (Katalogeintrag, Preisstatus „eigene Angabe“ mit Datum). Der Geometrie-Kern kennt keine Händler.
