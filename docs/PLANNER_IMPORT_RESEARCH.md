# Planer- und Produktimport: IKEA Österreich & Möbelix Österreich

_Stand: 2026-10-16, Runde 4 (nach Freigabe weiterer Domains). Frühere Runden: [`INTEGRATIONS_IKEA.md`](INTEGRATIONS_IKEA.md)._

Kennzeichnung: `VERIFIED` (in dieser Sitzung selbst geprüft) · `PARTIALLY VERIFIED` · `UNVERIFIED` (Hypothese, Code-Lektüre oder Sekundärquelle) · `UNAVAILABLE` (aus dieser Umgebung nicht prüfbar) · `BLOCKED` (Zugriffsschutz des Anbieters – wird respektiert).

Regeln dieser Untersuchung: nur öffentlich erreichbare Seiten und normale Browser-Abläufe (Headless-Chromium ohne Tarnung), sehr geringe Anfragezahl, keine Konten, keine fremden Planungen, kein Umgehen von Anmeldung, Bot-Schutz, Herkunftsprüfungen oder Ratenbegrenzung. Händlerinhalte (Seiten, Modelle) liegen nicht im Repository; Testdaten sind gekürzte strukturierte Daten bzw. eine eigene anonyme Testplanung.

## Kurzfazit

| Ziel | IKEA Österreich | Möbelix Österreich |
|---|---|---|
| Einzelprodukt (Name, Nr., Maße, Preis, Bild) | ✅ Ende-zu-Ende (Seite einfügen **oder** Hilfsskript) – `VERIFIED` | ❌ `BLOCKED` (Cloudflare-Challenge) |
| Echtes 3D-Modell (GLB) | ✅ Download + Laden in der App, Maße stimmen – `VERIFIED`; Direktabruf aus der App von IKEA gesperrt (Herkunftsprüfung) | ❌ nicht untersuchbar |
| Produktliste/Stückliste | ✅ Artikelnummern → Produktliste mit Modellen (Skript + Mehrdatei-Import) – `VERIFIED` | ❌ |
| Komplette Planung (Raum + Möbel, Positionen) | ✅ PAX/„StorageOne“-Planung als JSON → Raum + Korpusse – `VERIFIED` mit eigener Testplanung; JSON muss der Nutzer selbst aus seinem Browser holen | ❌ |
| Küchenplanung (METOD) | ❓ Backend aus dieser Umgebung gesperrt – `UNAVAILABLE` | ❌ |

**Ehrlich:** Komplettimport funktioniert für IKEA-**Aufbewahrungsplaner** (PAX, getestet), nicht für den Küchenplaner. Die App selbst ruft keine IKEA-Dienste auf; sie verarbeitet, was der Nutzer bereitstellt.

## 1. Erneut getestete Domains (2026-10-16, nach Freigabe)

| Host | Vorher | Jetzt | Bedeutung |
|---|---|---|---|
| `www.ikea.com` | erreichbar (Runde 3) | 200 | Produktseiten, Planer-Apps |
| `web-api.ikea.com` | Proxy-Sperre | **erreichbar** | `/dimma/assets/…` GLB: 200 ohne `Origin`, 200 mit `Origin: https://www.ikea.com`, **403 bei fremder Herkunft** (z. B. `http://localhost:4173`). `robots.txt`: `Disallow: /`, `Allow: /dimma/assets/` |
| `api.dexf.ikea.com` | Proxy-Sperre | **erreichbar** | ohne Schlüssel: `403 {"message":"The API key you provided does not have access…"}`; im Browser sendet IKEAs App einen eigenen `dexf-api-key` |
| `kitchen.planner.ikea.com` | Proxy-Sperre | 200 (nur die App-Hülle) | Backend `api.kitchen.planner.ikea.com` weiter **gesperrt** (Umgebung) |
| `www.moebelix.at` | 403 | 403 | **Cloudflare-Challenge** (`cf-mitigated: challenge`), auch im Browser; `challenges.cloudflare.com` hier gesperrt |
| weiterhin von der Umgebung gesperrt | | | `sik.search.blue.cdtapps.com` (Suche), `api.salesitem.ingka.com` (Verfügbarkeit), `api.ingka.ikea.com` (Gast-Token, Warenkorb), `content.dexf.ikea.com` (Planer-Modelle/Bilder), `account.dexf.ikea.com`, `api.kitchen.planner.ikea.com`, `www.gstatic.com` (Draco-Decoder des IKEA-Viewers), `api.moebelix.at` |

## 2. IKEA – Produkte

### 2.1 Produktseite (`VERIFIED`, KALLAX 104.099.32, ENHET 106.230.36, SALTSJÖBADEN S895.792.19)
* JSON-LD `Product`: `name`, `sku`/`mpn`, `width`/`depth`/`height` („111.5 cm“), `offers.price`/`priceCurrency`, `availability`, `color`, `material`, `category`, Bilder.
* JSON-LD `3DModel` mit `encoding[].contentUrl` (`model/gltf-binary`), Pfad `web-api.ikea.com/dimma/assets/1.2/{nr}/{set}/{qualität}/{format}/…`. Qualitäten `iqp1–3`, `rqp1–3`, `simple`; Formate `glb`, `glb_draco`, `gltf`. Gemessene Größen (KALLAX, Draco): iqp3 2,8 MB · iqp2 1,9 MB · iqp1 0,6 MB · rqp3 0,34 MB · rqp1 0,12 MB. ENHET hat nur `rqp`; die SALTSJÖBADEN-Kombination hat **kein** Modell.
* Kurz-URL `https://www.ikea.com/at/de/p/-{nr}/` bzw. `-s{nr}/` leitet per 301 auf die Produktseite weiter (Muster aus IKEAs Planer-Konfiguration `productInformationPageLinkV2`).

### 2.2 Produkt-Viewer „rotera“ (beobachtet, **nicht genutzt**)
Beim Öffnen der 3D-Ansicht lädt die Seite `web-api.ikea.com/at/de/rotera/data/{model|price|variations|complementary}/{nr}/` (JSON, Maße in mm, Preis inkl./exkl. MwSt., Varianten) und `…/rotera/static/models/{nr}-mini.glb` (80 kB). Die Datenendpunkte verlangen IKEAs `x-client-id` (ohne: 401) und sind per robots.txt ausgeschlossen → nicht verwendet.

### 2.3 3D-Modelle (`VERIFIED`)
* KALLAX iqp3: glTF 2.0, `KHR_draco_mesh_compression`, 1 Mesh, 4 PNG-Texturen, Meter, Y oben, Ursprung Bodenmitte. Bounding-Box 111,8 × 147,1 × 40,3 cm (Seite: 111,5 × 146,5 × 39). ENHET rqp3: 30,2 × 180,1 × 31,8 cm (Seite: 30 × 180 × 32,1).
* In der App geladen, auf Produktmaße skaliert, in 3D dargestellt (Screenshot geprüft). Ausrichtung „vorne = +Z“ entspricht der glTF-Konvention; visuell in der Software-Darstellung nicht eindeutig bestätigt (`PARTIALLY VERIFIED`).
* Direkter Abruf aus der App im Browser: IKEA antwortet bei fremder Herkunft mit 403 → **bewusste Sperre**, wird nicht umgangen (kein Proxy, kein Header-Fälschen). Legitime Wege: Link im Browser öffnen (Download) und Datei wählen, oder das Hilfsskript (s. u.).

### 2.4 Suche, Verfügbarkeit, Merkliste
Suche (`sik.search.blue.cdtapps.com`) und Verfügbarkeit (`api.salesitem.ingka.com`) sind in dieser Umgebung gesperrt (`UNAVAILABLE`); Suche ist zudem per robots.txt für Crawler ausgeschlossen. Merklisten/Warenkorb erfordern Gast-Token bzw. Konto → nicht genutzt.

## 3. IKEA – Planer und komplette Planungen

### 3.1 PAX/„StorageOne“-Planer (`VERIFIED`, eigene anonyme Testplanung)
Ablauf im Browser: Planer öffnen → Korpus/Kombination wählen → **„Zusammenfassung“**. Dabei speichert der Planer ohne Konto:
1. `POST api.dexf.ikea.com/vpc/v1/room/configurations` → `{"roomId":"3V9YZ44"}` (Raum)
2. `POST api.dexf.ikea.com/vpc/v1/configurations/retailunit/AT/locale/de-AT` → `{"configurationId":"343J5TD", "_links": {"short-url": ".../pax/web/latest/at/de/#/u/343J5TD", …}}`

Erneutes Öffnen über `…/#/u/343J5TD` lädt `GET …/vpc/v1/configurations/retailunit/AT/locale/de-AT/343J5TD` (mit IKEAs `dexf-api-key`) – **Hin- und Rückweg geprüft**. „Speichern“ im Profil verlangt dagegen ein Konto.

Inhalt der gespeicherten JSON:
* `itemList.item[]` – Artikel und Mengen (z. B. 13 Positionen für eine Eckkombination).
* `icf.content.articles[]` – jedes Teil mit `product_id` (`ART-80458207`), `category` (`pax-hinge-frame`, `pax-shelf`, …), `dimensions` (mm: x Breite, y Höhe, z Tiefe), `transform.position` (mm, Mittelpunkt, y oben), `transform.rotation` (Grad um y, z. B. 270), `parent_ids`/`child_ids` (Einbauteile → Korpus).
* `configuration.content.entities[]` – Szenengraph inkl. Raum: Bodenfläche mit `cornerPersistentIds`, Ecken mit Position (mm), Deckenecken (y = Raumhöhe), Wände (`kv-wall`, `wallState`).

**Umgesetzt:** Import dieser JSON → Raum (lichte Maße) + Korpusse an ihren Positionen/Rotationen; Einbauteile je Korpus zusammengefasst. Geprüft: 5 × 4 m-Raum mit L-förmiger Kombination, keine Wandkollisionen, 3D-Darstellung angesehen.

**Wie kommt der Nutzer an die JSON?** Die App darf IKEAs Dienst nicht selbst aufrufen (das ginge nur mit IKEAs eigenem Anwendungsschlüssel). Weg für die eigene Planung: Planung im IKEA-Planer öffnen (Planungscode-Link) → Entwicklerwerkzeuge (F12) → Netzwerk → Filter `configurations` → Anfrage mit dem Code → Antwort speichern/kopieren → in der App _Import › „IKEA-Planung (JSON) übernehmen“_. (`NEEDS USER TEST` – der Ablauf in DevTools ist für Laien umständlich.)

Grenzen: Korpusse werden als maßgenaue Näherungsmodelle dargestellt (Planer-Modelle liegen auf `content.dexf.ikea.com`, hier gesperrt); Türen/Griffe nicht separat; die Eckeinsatz-Koordinaten im ICF sind uneinheitlich (Teil wird nur als Einbauteil gezählt); Raumöffnungen (Fenster/Türen) im Planer nicht untersucht.

### 3.2 Küchenplaner METOD (`UNAVAILABLE`)
`kitchen.planner.ikea.com` lädt, braucht aber `api.kitchen.planner.ikea.com` (CSRF-Token, Service-Discovery) – hier gesperrt. Aus dem Code: Routen `/planner/:designId/`, `/designs/:designId/share/`, `/login/` → Planungen sind an Konten gebunden; ob ein ICF-Export wie bei PAX existiert, ist offen (`UNVERIFIED`).

### 3.3 Andere Planer
`/addon-app/space/…` (Raum-/Konfiguratorplattform), `coro3`, `skytta` – nicht untersucht.

## 4. Möbelix Österreich (`BLOCKED`)
Website und robots.txt antworten mit Cloudflare-Challenge (curl und Browser); die Challenge-Skripte (`challenges.cloudflare.com`) sind hier zusätzlich gesperrt. Es wird nicht versucht, das zu umgehen. Kein API-, Modell- oder Planer-Befund möglich. Der Weg „Seitenquelltext aus dem eigenen Browser einfügen“ steht in der App bereit (`NEEDS USER TEST`).

## 5. Umgesetzt (Code)

| Baustein | Datei | Tests |
|---|---|---|
| schema.org-`3DModel` lesen, IKEA-Variantenwahl (iqp2 → … → rqp1, Draco bevorzugt) | `src/catalog/providers/structuredData.ts`, `ikeaModels.ts` | Unit |
| Artikelnummern aus Text, Kurz-URL, Kategorie-Heuristik | `src/catalog/providers/ikeaList.ts` | Unit |
| Hilfsskript Artikelnummern → `produktliste.json` (+ GLB) | `scripts/ikea-products.mjs` | echter Lauf: KALLAX, ENHET (mit GLB), SALTSJÖBADEN |
| Produktliste + `.glb` gemeinsam importieren (Prüfung, Maßvergleich) | `src/catalog/catalogImport.ts` | Unit + E2E |
| IKEA-Planung (JSON) → Raum + Korpusse | `src/catalog/providers/ikeaPlanner.ts`, `src/import/ikeaPlanActions.ts` | Unit + E2E (gekürzte echte Testplanung) |
| Verständliche Meldung, warum der Direktabruf scheitert | `registry.ts`, `ProductImportModal.tsx` | E2E |

Echter Ende-zu-Ende-Lauf (lokal, nicht im Repo): `node scripts/ikea-products.mjs "104.099.32, 2x 106.230.36, S895.792.19" --models` → 3 Produkte, 2 GLB → in der App importiert → platziert → 3D ohne Fehler.

## 6. Offene Punkte / was ich brauche
1. **Küchenplaner:** Freigabe von `api.kitchen.planner.ikea.com` (und für Planer-Modelle `content.dexf.ikea.com`) in den Netzwerkeinstellungen der Umgebung – dann untersuche ich, ob METOD-Planungen ein ähnliches Format liefern.
2. **Testen:** eine eigene PAX-Planung per DevTools-JSON importieren; ob der Weg für dich praktikabel ist.
3. **Möbelix:** eine Produktseite aus deinem Browser einfügen (Strg+U) und melden, was erkannt wird; sonst bleibt Möbelix blockiert.
4. **Rechtliches:** IKEAs Nutzungsbedingungen zu Modellen/Planungsdaten nicht geprüft – die App behandelt alles als „privat, nicht weitergeben“.

## 7. Sinnvolle nächste Schritte
* Planungsimport um Türen/Griffe und echte Korpus-Modelle erweitern (falls `content.dexf.ikea.com` erlaubt und Nutzung zulässig).
* Stückliste der Planung (`itemList`) direkt an das Hilfsskript übergeben → Namen, Preise, Modelle für alle Teile.
* Einfacherer Weg für den Nutzer, die Planungs-JSON zu erhalten (Anleitung mit Screenshots).
