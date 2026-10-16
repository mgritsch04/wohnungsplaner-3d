# Planer- und Produktimport: IKEA Österreich & Möbelix Österreich

_Stand: 2026-10-16 (Runde 3). Vorgängerrunden: [`INTEGRATIONS_IKEA.md`](INTEGRATIONS_IKEA.md)._

Kennzeichnung: `VERIFIED` (in dieser Sitzung selbst geprüft) · `PARTIALLY VERIFIED` · `UNVERIFIED` (nur aus Code-Lektüre/Sekundärquellen) · `UNAVAILABLE` (aus dieser Umgebung nicht prüfbar) · `BLOCKED` (Zugriffsschutz – wird respektiert).

Grundregeln dieser Untersuchung: nur öffentlich erreichbare Seiten, normale Browser-/HTTP-Abrufe in sehr geringer Zahl (≈ 10 Seitenabrufe + die von einer Planer-Seite selbst geladenen Skripte), kein Umgehen von Anmeldung, Bot-Schutz oder Ratenbegrenzung, keine Nutzerkonten, keine Weitergabe von Händlerinhalten im Repository (Tests nutzen nur einen gekürzten Auszug der strukturierten Daten).

## Kurzfazit

| Ziel | Ergebnis | Status |
|---|---|---|
| **Einzelprodukt IKEA AT** (Name, Artikelnr., Maße, Preis, Bild, 3D-Modell-Adresse) | Echte Produktseiten enthalten vollständige schema.org-Daten (`Product` + `3DModel`). Unser Parser liest sie korrekt; echter End-to-End-Lauf in der App: Seite einfügen → übernehmen → im Plan platzieren | `VERIFIED` (2 echte Seiten, 1 echter E2E-Lauf) |
| **3D-Modell (GLB) von IKEA laden** | Adressen werden von der Seite selbst deklariert (`web-api.ikea.com/dimma/assets/…glb`), 21 Varianten bei KALLAX. Download/CORS/Lizenz hier nicht prüfbar: Host in dieser Umgebung gesperrt | Adressen `VERIFIED`, Abruf `UNAVAILABLE` |
| **Möbelix AT** | Website antwortet mit Cloudflare-Bot-Challenge (`cf-mitigated: challenge`, HTTP 403) | `BLOCKED` – wird nicht umgangen |
| **Produktlisten / Planer-Stücklisten** | Kein öffentliches Austauschformat gefunden; Merklisten und geteilte Planungen liegen hinter Konto bzw. sind per robots.txt ausgeschlossen | `UNVERIFIED` |
| **Komplette Planer-Pläne (PAX, BESTÅ, METOD-Küche …)** | Planungen liegen serverseitig im „DEXF“-Dienst von IKEA; Laden erfordert einen app-internen API-Schlüssel und für gespeicherte Entwürfe ein Konto-Token | **Nicht legitim umsetzbar** (`UNVERIFIED` im Detail, da Dienst hier gesperrt) |
| **Geometrie/Positionen aus Planern** | Nur innerhalb der Planer-App (WebGL); kein öffentliches Exportformat gefunden | `UNVERIFIED` |

**Ehrliche Einordnung:** Der Import _einzelner echter IKEA-Produkte_ funktioniert jetzt nachweislich mit echten Daten. Ein Import _kompletter Planer-Pläne_ (Küche, PAX …) funktioniert **nicht** und lässt sich ohne offizielle Freigabe durch IKEA auch nicht sauber bauen.

## 1. Erreichbarkeit aus dieser Umgebung (2026-10-16)

| Host | Ergebnis | Bedeutung |
|---|---|---|
| `www.ikea.com` | HTTP 200 (auch mit Standard-curl-Kennung) | **neu erreichbar** (Runden 1–2: gesperrt) |
| `web-api.ikea.com` (3D-Assets) | Proxy verweigert Tunnel (`ERR_TUNNEL_CONNECTION_FAILED`) | Netzwerkrichtlinie der Umgebung |
| `api.dexf.ikea.com` (Planer-Backend) | dto. | dto. |
| `kitchen.planner.ikea.com`, `planner.ikea.com` | Proxy: 403 beim CONNECT | dto. |
| `sik.search.blue.cdtapps.com`, `api.ingka.ikea.com` | dto. | dto. |
| `www.moebelix.at` | HTTP 403 **von Cloudflare** mit Bot-Challenge („Just a moment…“) | Zugriffsschutz der Website → `BLOCKED`, wird respektiert |

## 2. IKEA Österreich – Produktseiten (`VERIFIED`)

Geprüft: `KALLAX Regal weiß` (`/at/de/p/kallax-regal-weiss-10409932/`) und `SALTSJÖBADEN 3er-Bettsofa` (Kombination `s89579219`).

* `<script type="application/ld+json" id="pip-range-json-ld">` mit `@type: Product`: `name`, `sku`/`mpn` (`104.099.32`), `width`/`depth`/`height` als Text mit Einheit (`"111.5 cm"`, `"39 cm"`, `"146.5 cm"`), `offers.price`/`priceCurrency` (`99`, `EUR`), `availability`, `color`, `material`, `category`, Bilder (`ImageObject`), Bewertungen.
* Zweiter Block `@type: 3DModel` mit `encoding[]` → `MediaObject` `{contentUrl, encodingFormat: "model/gltf-binary"}`. KALLAX: 21 Varianten (Pfadteile `iqp1–3`, `rqp1–3` = vermutlich Qualitätsstufen, je `glb`, `glb_draco`, `gltf`, plus `geomagical/simple`). Die Bedeutung der Stufen ist **nicht dokumentiert** (`UNVERIFIED`); die Seite listet eine Draco-komprimierte Variante zuerst – die App nimmt die erste.
* Nicht jedes Produkt hat ein Modell: Die SALTSJÖBADEN-Kombination enthält **keinen** `3DModel`-Block (Maße/Preis aber vollständig).
* Das in Runde 2 aus Fremdcode übernommene Element `<script id="pip-xr-viewer-model">` kommt auf beiden Seiten **nicht** vor → veraltet. Die App nutzt jetzt das standardisierte schema.org-`3DModel` und behält die alte Heuristik nur als Rückfall.
* robots.txt von ikea.com (geprüft): u. a. `Disallow: */home-design/share/*` (geteilte Planungen), `*/ikea-family/home-project-planner/*`, `*/3daas-rotera/*`, `*/global/assets/rotera/*`, `*/favourites/*`, `*/shoppingcart/*`. Diese Pfade ruft die App nicht ab und soll sie auch künftig nicht automatisiert abrufen.

### Proof of Concept (echt, Ende-zu-Ende) – `VERIFIED`
Lokaler Playwright-Lauf mit der echten KALLAX-Seite (Quelltext eingefügt wie vom Nutzer per Strg+U):
1. Erkannt als HTML; Quellen: JSON-LD, Meta, „3D-Modell (schema.org 3DModel, 21 Varianten)“, Maßzeilen.
2. Qualität „vollständig aus Quelle“; Name `KALLAX Regal - weiß 112x147 cm`, Artikelnr. `104.099.32`, Preis € 99,00, Maße 111,5 × 39 × 146,5 cm, Kategorie „Schränke & Regale“.
3. „Modell direkt laden“ → Abruf scheitert hier an der Netzsperre (`ERR_TUNNEL_CONNECTION_FAILED`); die App zeigt den vorgesehenen Ausweg (Link öffnen, Datei wählen).
4. „Hinzufügen und platzieren“ → Objekt im Plan mit IKEA-Maßen, Händler, Link; im 3D als maßstäbliche Näherung.

Die echte Seite wird **nicht** ins Repository übernommen. Regressionstest: gekürzter Auszug der beiden JSON-LD-Blöcke in `src/catalog/providers/providers.test.ts`.

## 3. IKEA-Planer (`UNVERIFIED` im Detail – Backend hier gesperrt)

Gefundene Planer (Seite `/at/de/planners/`):
* Küche METOD: `https://kitchen.planner.ikea.com/at/de/` (eigener Host).
* „StorageOne“-Planer auf www.ikea.com: `/addon-app/storageone/{pax|besta|billy|kallax|platsa|smastad|eket|ivar|boaxel|…}/web/latest/at/de/`.
* „Space“-Plattform (Räume/Konfiguratoren): `/addon-app/space/platform/latest/at/de/…`, weitere: `coro3`, `skytta`, `guida`.

Statische Analyse der vom PAX-Planer geladenen Skripte (normale Seitenauslieferung, 104 Dateien, 1,5 MB) und eine Beobachtung im Browser:
* Beim Start fordert der Planer `GET https://api.dexf.ikea.com/setting/v1/data/apps/storageonepax/retail-units/AT/locales/de-AT` an – in dieser Umgebung gesperrt, daher startet der Planer hier nicht (`UNAVAILABLE`).
* Produktdaten: `https://api.dexf.ikea.com/product/…`, `…/webplanner/…`. Anfragen tragen einen Header `dexf-api-key` (in der App hinterlegter Schlüssel) und für Konto-Funktionen `Authorization: Bearer <Nutzertoken>`.
* Planungen: Routen `/vpc/:vpcCode` (Planungscode zum Weitergeben), `/designId/:designId`, `/spr/:sprId`; Speichern/Laden über `…/designs/{ID}/with-sections` mit API-Schlüssel und Nutzertoken. Ein Ladeweg für VPC-Codes ohne Konto war in den initial geladenen Skripten nicht auffindbar.
* Ein Exportformat (Datei) für Planungen wurde nicht gefunden.

**Bewertung:** Ein Import kompletter Planungen müsste diesen nicht dokumentierten Dienst mit einem Schlüssel aufrufen, der IKEAs eigener App gehört, und für gespeicherte Planungen ein Konto-Token verwenden. Das wäre eine nicht autorisierte Nutzung bzw. Zugriff auf private Kontodaten → **wird nicht umgesetzt**. Auch das Abrufen geteilter Planungsseiten (`/home-design/share/`) ist per robots.txt ausgeschlossen.

**Legitimer Ersatzweg (Vorschlag, nicht umgesetzt):** Die Planer zeigen eine Zusammenfassung/Einkaufsliste mit Artikelnummern und Mengen. Der Nutzer könnte diese Liste kopieren; die App erkennt Artikelnummern (`XXX.XXX.XX`, Kombinationen `SXXX.XXX.XX`) und Mengen und legt Einträge an, deren Maße/Preise dann je Produktseite (wie oben) ergänzt werden. Positionen/Geometrie der Planung gehen dabei verloren. Das genaue Textformat der Zusammenfassung ist **unbekannt** (`UNVERIFIED`) – dafür brauche ich ein Beispiel von dir.

## 4. Möbelix Österreich – `BLOCKED`

`https://www.moebelix.at/` und `robots.txt` liefern aus dieser Umgebung eine Cloudflare-Challenge (`server: cloudflare`, `cf-mitigated: challenge`). Das ist ein Bot-Schutz; er wird nicht umgangen (kein Headless-Lösen, keine Header-Tricks). Über Planer, Produktlisten oder 3D-Modelle bei Möbelix lässt sich deshalb nichts Neues sagen.

Was trotzdem funktioniert: Der bestehende Weg „Seitenquelltext aus deinem Browser einfügen“ – wenn Möbelix schema.org-Daten ausliefert, liest die App sie wie bei IKEA. (`NEEDS USER TEST`)

## 5. Architektur (unverändert modular)

* Händlerlogik nur in `src/catalog/providers/` (Registry, Parser, Umwandlung, Modellabruf); Geometrie-Kern unberührt.
* Neu: `collectModels()` liest schema.org-`3DModel` (alle glTF/GLB-Kodierungen, Seitenreihenfolge) → `ParsedProductPage.modelCandidates`, `modelUrl` = erste Variante; die Heuristik (`pip-xr-viewer-model`, `.glb`-Adressen) greift nur noch, wenn keine Deklaration vorhanden ist.
* Ein künftiger Planer-Adapter (Stückliste) würde als weiterer Provider-Baustein neben `structuredData.ts` liegen.

## 6. Was ich von dir brauche

1. **Netzwerkfreigabe (optional, für Prüfung der 3D-Modelle):** Die Netzwerkrichtlinie dieser Umgebung sperrt `web-api.ikea.com` (und `api.dexf.ikea.com`, `kitchen.planner.ikea.com`). Freigabe in den Umgebungseinstellungen unter _Network access → Allowed domains_ (Anleitung: https://code.claude.com/docs/en/cloud-environments#network-access). Dann prüfe ich Download, CORS-Header und Modellmaße einer GLB-Datei.
2. **Selbst testen (am wichtigsten):** In der App _Katalog → „Produkt von Händlerseite übernehmen“_ mit einer echten IKEA-Seite (Strg+U, alles kopieren) und „Modell direkt laden“. Ob IKEA den Direktabruf aus der App erlaubt (CORS), zeigt nur dein Browser.
3. **Möbelix:** eine Produktseite im Browser öffnen, Quelltext in die App einfügen und mir sagen, was erkannt wird.
4. **Planer-Stückliste:** falls gewünscht, den kopierten Text einer IKEA-Planer-Zusammenfassung (ohne persönliche Daten) – dann baue ich den Stücklisten-Import.
5. **Lizenzfrage:** Nutzungsbedingungen für IKEA-3D-Modelle sind nicht geprüft; die App zeigt nur einen Hinweis „privat nutzen, nicht weiterverbreiten“.
