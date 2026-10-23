# Integration echter Produkte: IKEA Österreich & Möbelix Österreich

_Stand: 2026-10-16 (2. Untersuchungsrunde ergänzt)._  Kennzeichnung: `VERIFIED` (selbst geprüft) · `PARTIALLY VERIFIED` · `UNVERIFIED` (nur aus Sekundärquellen) · `UNAVAILABLE` (Test nicht möglich)._

> **Runde 3 (2026-10-16):** `www.ikea.com` ist inzwischen erreichbar. Echte Produktseiten wurden geprüft – Ergebnisse, Planer-Analyse und Möbelix-Blocker stehen in [`PLANNER_IMPORT_RESEARCH.md`](PLANNER_IMPORT_RESEARCH.md). Wichtigste Korrekturen: Die 3D-Modelle sind als schema.org-`3DModel` deklariert; das unten erwähnte `pip-xr-viewer-model` kommt auf den geprüften Seiten nicht vor (veraltet).

## Einrichtungsvorschlag mit Claude: Produktsuche (#350, 2026-10-23)

Auf Gs Entscheidung (Option A) sucht Claude für Platzhalter des Einrichtungsvorschlags selbst echte Produkte – so, wie ein Mensch im Shop sucht:

* **Im App-Artefakt in der Claude-Desktop-App:** Claude öffnet über den eingebauten Browser der App (`host:claude_browser`, Werkzeuge `navigate`, `get_page_text`, `read_page`) die Such- und Produktseiten von `www.ikea.com/at` und `www.moebelix.at`. Die Seite lässt nur diese beiden Adressen zu (`src/assistant/productSearch.ts`). Außerhalb der Desktop-App gibt es die Suche nicht.
* **Im lokalen Planer (`npm run dev`):** Der lokale Helfer (`npm run ikea-helper`) reicht die Anfrage an die Claude-Code-Kommandozeile auf demselben Rechner weiter (`POST /claude`, `scripts/lib/claude-cli.mjs`): nur Websuche und Abruf von Seiten dieser zwei Shops, Shell/Dateien schreiben gesperrt, leerer Arbeitsordner, bis zu 4 Anfragen gleichzeitig (`WP_CLAUDE_PARALLEL`; der Einrichtungsvorschlag fragt raumweise parallel und sucht Produkte 3 gleichzeitig). Gefundene IKEA-Seiten liest danach der Helfer wie bisher selbst (genaue Maße, Preis, 3D-Modell).
* Kein Schlüssel im Browser, keine Konten, keine Warenkörbe, keine internen Schnittstellen, keine Umgehung von Bot-Schutz. Was Claude meldet, prüft die App (Shop-Adresse, plausible Maße und Preis); Produkte ohne vollständige Angaben werden weggelassen. Gefundene Produkte landen in „Meine IKEA-/Möbelix-Auswahl“ mit Hinweis „von Claude gefunden“.

## IKEA-Auswahl im Planer mit lokalem Helfer (2026-10-17)
Katalog › Unterreiter **„IKEA“**: Links von ikea.com/at oder Artikelnummern einfügen, **„Holen“** drücken; das Produkt landet mit Bild, Maßen, Preis (mit Abrufdatum) und – wenn gewünscht – dem echten 3D-Modell in **„Meine IKEA-Auswahl“** und lässt sich per Klick („In den Raum“) oder Ziehen platzieren. Die Auswahl bleibt lokal gespeichert.

* Abgerufen wird über den **lokalen Helfer** `npm run ikea-helper` (`scripts/ikea-helper.mjs`, Port 4791, nur 127.0.0.1). Er nutzt denselben Weg wie `scripts/ikea-products.mjs` (gemeinsam in `scripts/lib/ikea-fetch.mjs`): genau eine öffentliche Produktseite pro eingefügter Nummer, höchstens eine Anfrage alle 1,5 s, max. 25 pro Durchgang, Zwischenspeicher `ikea-import/auswahl/` (Produktdaten 24 h, Modelle dauerhaft). Keine Suche, keine Konten, keine internen Schnittstellen.
* Der Helfer beantwortet nur Anfragen von `localhost`/`127.0.0.1` (andere Websites bekommen HTTP 403).
* Eine **Produktsuche im Planer gibt es bewusst nicht**: IKEA bietet keine öffentliche Such-API; die Such-Endpunkte sind intern. Gesucht wird auf ikea.com, der Link kommt in den Planer.
* Im Claude-App-Artefakt ist „Holen“ nicht verfügbar (kein Helfer erreichbar); dort bleiben Auswahl und Ordner-Import.
* Getestet 2026-10-17 mit echter Seite (KALLAX 104.099.32: Name, 111,5 × 39 × 146,5 cm, Preis, GLB 1,9 MB) bis zur Platzierung in 3D.

## Lesezeichen „An Planer senden“ (#221, 2026-10-17)
Katalog › IKEA › „Lesezeichen „An Planer senden““: den Knopf in die Lesezeichenleiste ziehen. Auf einer selbst geöffneten Produktseite von **ikea.com** oder **moebelix.at** schickt ein Klick die Daten **dieser einen Seite** (Meta-Angaben, schema.org/JSON-LD, sichtbarer Text) an den lokalen Helfer; der Planer übernimmt sie in „Meine IKEA-Auswahl“ (Hinweis „neu vom Lesezeichen“).

* **Weg:** Die Content-Security-Policy von ikea.com verbietet Anfragen an fremde Hosts (geprüft 2026-10-17: `connect-src` über `default-src`), erlaubt aber eingebettete Seiten (`frame-src *`). Das Lesezeichen bettet deshalb die Empfangsseite des Helfers (`http://127.0.0.1:4791/empfang`, nur in ikea.com/moebelix.at einbettbar) ein und reicht ihr die Daten per `postMessage` (nur an die Helfer-Herkunft); diese sendet sie an `/inbox`.
* **Absicherung:** geheimes Token in `ikea-import/auswahl/.lesezeichen-token` (vom Helfer beim ersten Start erzeugt, nie im Repository), nur im eigenen Lesezeichen; ohne gültiges Token wird nichts übernommen. Token und Eingang kann nur der lokal geöffnete Planer lesen.
* **Kein Scraping:** eine Seite pro Klick, nur die Seite, die man selbst offen hat; der Helfer ruft dabei für IKEA höchstens das auf der Seite deklarierte 3D-Modell ab (nur `web-api.ikea.com/dimma/assets/`). Möbelix: nur Seitendaten, kein Modell. Was die Seite nicht liefert (z. B. Maße), bleibt leer bzw. das Produkt wird nicht übernommen.
* Getestet 2026-10-17 mit echter Seite (KALLAX 104.099.32): Lesezeichen auf ikea.com → Planer zeigt Name, Maße, Preis, 3D-Modell. Möbelix-Seiten sind aus der Entwicklungsumgebung gesperrt (Cloudflare) → `NEEDS USER TEST`.

## Fehlende Maße, runde Produkte (#269, 2026-10-18)
* **Runde Produkte:** „Ø“, „Durchmesser“, „Durchmesser Übertopf“, „Topfgröße“ und „diameter“ gelten als Breite und Tiefe, aber nur, wenn keine Breite oder Tiefe genannt ist. „Pflanzenhöhe“ und „Höhe der Pflanze“ gelten als Höhe. Bei Spannen („120-140 cm“) wird nur bei Pflanzengrößen der obere Wert verwendet. Die Zahl im Produktnamen wird nie verwendet.
* **Maße fehlen trotzdem:** Das Produkt wird nicht verworfen. Es wartet unter Katalog › IKEA › „Maße fehlen“ (gespeichert in localStorage auf diesem Gerät) mit allem, was die Seite angibt. Erst wenn man die fehlenden Maße selbst eingetragen hat, kommt es in die Auswahl (gleiche Schema-Prüfung wie sonst).
* **Schätzung aus dem 3D-Modell:** Auf Knopfdruck misst der Planer das IKEA-Modell, das der Helfer ohnehin geladen hat (Umrandung, glTF in Metern), ohne weitere Abrufe. Das Ergebnis wird nur als Vorschlag „ca.“ in die leeren Felder eingetragen. Bei Pflanzen zählen die Blätter mit. Nutzung wie beim Modell selbst: nur privat, keine Weitergabe (Nutzungsbedingungen weiterhin nicht einsehbar, siehe unten).

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


---

## Runde 2 (2026-10-16): inoffizielle Schnittstellen, 3D-Viewer, GLB

### Erneuter Zugriffstest
| Ziel | Ergebnis | Status |
|---|---|---|
| `www.ikea.com/robots.txt`, `www.ikea.com/at/de/`, `sik.search.blue.cdtapps.com`, `web-api.ikea.com` | Verbindung abgelehnt (Status 000, Proxy) | UNAVAILABLE |
| `www.moebelix.at/robots.txt`, `api.moebelix.at` | Verbindung abgelehnt | UNAVAILABLE |

Eigene Tests gegen IKEA/Möbelix-Server, Netzwerk-Mitschnitte und Modell-Downloads waren in dieser Umgebung **nicht möglich**. Nichts davon wurde simuliert oder angenommen.

### IKEA 3D-Viewer → GLB (Recherche)
| Befund | Quelle | Status |
|---|---|---|
| Mehrere Browser-Erweiterungen/Skripte laden GLB-Modelle von IKEA-Produktseiten mit „3D-Ansicht“ herunter | [Firefox-Add-on IMD](https://addons.mozilla.org/addon/imd-3d/), [Chrome-Erweiterung](https://chromewebstore.google.com/detail/kihdhjecfjagoplfnnpdbbnhkjhnlfeg), [Bericht korben.info](https://korben.info/en/download-ikea-3d-models-blender-unity-maya.html) | UNVERIFIED |
| Ein Open-Source-Skript liest das Element `<script id="pip-xr-viewer-model">` aus; dessen JSON-Feld `url` ist die GLB-Adresse. Keine Anmeldung, keine Cookies, keine speziellen Header | [ikea-glb-downloader.py](https://github.com/apinanaivot/IKEA-3d-model-batch-downloader) (GPL-3.0, nur an der finnischen Seite getestet) | UNVERIFIED (Fremdcode gelesen, nicht live geprüft) |
| Die Modelle bleiben Eigentum von IKEA; Nutzung nur privat/zu Lernzwecken, keine Weitergabe/Wiederverkauf (Aussage eines Leitfadens) | [korben.info](https://korben.info/en/download-ikea-3d-models-blender-unity-maya.html) | UNVERIFIED – AGB von ikea.com/at nicht einsehbar |
| Ob die GLB-Adresse dauerhaft gültig oder zeitlich begrenzt ist, ob der Server CORS erlaubt, Maßstab/Ausrichtung/Ursprung der Modelle | – | UNAVAILABLE |

### Möbelix
Kein 3D-Viewer, keine Modell-Assets und keine öffentliche API gefunden (`UNVERIFIED`). Produktdaten nur über eingefügten Seitenquelltext bzw. Produktlisten.

### Umgesetzter End-to-End-Weg (ohne Umgehung, ohne Entwicklertools)
1. Seitenquelltext einer Produktseite (Strg+U) in „Produkt von Händlerseite übernehmen“ einfügen.
2. Die App liest JSON-LD/Meta-Angaben, Maßzeilen **und** eine Modell-Adresse (`pip-xr-viewer-model` bzw. eine `https://…glb`-Adresse im Quelltext).
3. **„Modell direkt laden“**: normaler `fetch` mit CORS-Prüfung, 15 s Zeitlimit. Wird der Abruf vom Server nicht erlaubt, erklärt die App das und bietet …
4. **Rückfall**: „Modell-Link im Browser öffnen“ → Browser lädt die `.glb` → im Dialog auswählen.
5. Das Modell wird geprüft (Format, Version, Geometrie), gemessen und mit den Produktmaßen verglichen (Abweichung in %, Erkennung einer 90°-Drehung), lokal gespeichert und am Katalogobjekt hinterlegt.

| Prüfung | Ergebnis | Status |
|---|---|---|
| Parser für `pip-xr-viewer-model` und `.glb`-Adressen (synthetische Seiten) | Unit-Tests grün | VERIFIED (synthetisch) |
| Ablauf mit simuliertem Händlerserver: ohne CORS-Freigabe → verständliche Meldung + Dateiauswahl; mit Freigabe → Direktabruf; Modell erscheint am Produkt im Plan | Playwright grün (Chromium setzt CORS real durch) | VERIFIED (simuliert) |
| Dasselbe mit einer echten IKEA-Seite und einem echten IKEA-GLB | nicht möglich (Netz) | NEEDS USER TEST |

### Untersuchte, aber bewusst nicht genutzte Wege
| Weg | Grund | Status |
|---|---|---|
| Inoffizielle Such-/Produkt-JSON-Endpunkte (z. B. von `ikea_api` genutzt) | Nicht erreichbar; undokumentiert, ändern sich laut Berichten; Nutzung nicht ausdrücklich erlaubt. Bei Netzfreigabe könnte ich die Antworten einzelner Artikel stichprobenartig prüfen | UNAVAILABLE |
| Massen-Download ganzer Kategorien (wie im Batch-Skript) | Nicht im Sinne „wenige, zurückhaltende Anfragen“; Lizenz unklar | abgelehnt |
| Proxy-Server, um CORS zu umgehen | Wäre technisch ein Umgehen der Browser-Schutzregel für fremde Inhalte; nur denkbar mit Erlaubnis des Händlers | abgelehnt |

### Was ich von dir brauche (kleinster sinnvoller Beitrag)
1. **Eine IKEA-Österreich-Produkt-URL mit „3D-Ansicht“** (z. B. ein Regal).
2. In deinem Browser: Seite öffnen → Strg+U → Strg+F nach `pip-xr-viewer-model` suchen → **nur diese eine Zeile** (das `<script …>…</script>`-Element) kopieren und mir schicken – oder melden, dass es sie nicht gibt.
3. Optional: Den ganzen Quelltext in den Dialog einfügen, „Modell direkt laden“ klicken und mir die angezeigte Meldung schicken (sagt, ob CORS erlaubt ist). Falls blockiert: „Modell-Link im Browser öffnen“, Datei wählen, und mir die angezeigte Maßabweichung nennen.
4. Alternativ: In den Umgebungseinstellungen (Network access) `www.ikea.com` und `www.moebelix.at` freigeben – dann prüfe ich robots.txt, Produktseiten-Struktur und einzelne Anfragen selbst (zurückhaltend, keine Massenabfragen).

Die übrige Arbeit hängt nicht davon ab.
