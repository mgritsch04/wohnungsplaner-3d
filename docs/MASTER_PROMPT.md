# Master-Spezifikation (Arbeitsauftrag)

Dieses Dokument hält den vollständigen Arbeitsauftrag im Repository fest, damit er über Sitzungen
hinweg gilt. Teil A ist die ursprüngliche Produktspezifikation (verdichtet, alle Anforderungen
erhalten), Teil B die Ergänzung zu Arbeitsweise, Git, Status-Dashboard und Händler-Integrationen.
Kommunikation mit dem Nutzer: **Deutsch**.

---

## Teil A – Produktspezifikation „Advanced 2D/3D Apartment Planner“

Rolle: autonomer Lead-Architekt, Full-Stack-, 3D-, UX- und QA-Engineer. Funktionierende, getestete
Software statt Mockups; Repository jederzeit lauffähig; Rückfragen nur bei echten Blockern.

1. **Umgebung/Repo zuerst prüfen**, nichts Bestehendes ohne Grund überschreiben. Git: Feature-Branches,
   aussagekräftige Commits, kein Force-Push, kein Merge ohne Freigabe, keine erfundenen Erfolge.
2. **Produktvision:** präziser 2D-Grundriss + realistische, begehbare 3D-Wohnung auf **einem** Datenmodell;
   Räume, Plan-Import, Wände/Türen/Fenster mit echten Maßen, Möbel/Geräte/Licht/Deko, Materialien,
   Schatten, Ich-Perspektive, Küchenplanung, echte Produktdaten (wo erlaubt), Budget, Speichern/Export,
   Qualitätsmodi. Muss ohne externe Dienste nützlich bleiben.
3. **Technik:** TypeScript, React, Vite, Three.js/R3F/Drei, Schema-Validierung, IndexedDB, Tests.
   Saubere Trennung UI/Domäne/Rendering/Import/Katalog/Persistenz/Berechnung; Meter intern; versionierte Daten.
4. **2D-Editor:** Raster/Fang, Zoom/Pan, Auswählen/Verschieben/Drehen/Löschen, Undo/Redo, Bemaßung,
   numerische Maße, Wände (Dicke/Höhe, Ecken, Verschneidungen), Türen/Fenster, Raumnamen/-flächen,
   Tastenkürzel, echte Architekturgeometrie statt Zeichnung.
5. **Plan-Import (PDF/PNG/JPG):** Seitenwahl, Underlay (Deckkraft, Zoom, Drehen, Ausrichten, Zuschneiden,
   Sperren, Ein/Aus), **Pflicht-Kalibrierung** über zwei Punkte, unkalibriert klar kennzeichnen,
   Kontrollmaße; erweiterbare (KI-)Erkennung (Vektor vs. Raster), externe Dienste nur hinter Adapter,
   ohne Schlüssel im Client und nur mit Zustimmung; **Prüfstufe** vor Übernahme (bekannt/geschätzt/unsicher);
   übernommene Geometrie wird normales, editierbares Modell; Worker/Fortschritt, Ressourcen freigeben.
6. **`apartment-plan.json`:** versioniert, dokumentiert, validiert, Import/Export, Migration, Tests,
   so beschrieben, dass eine KI gültige Dateien erzeugen kann.
7. **Zentrales Modell:** Räume, Wände, Öffnungen, Böden/Decken, Möbel, Materialien, Licht, Transformationen,
   Einstellungen; gespeicherte Geometrie getrennt von abgeleiteten Meshes; stabile IDs.
8. **3D:** echte Wanddicken/-höhen und Öffnungen, Böden/Decken, PBR-Materialien, Licht/Schatten, Kameras,
   Wechsel 2D/3D; erst Korrektheit, dann Effekte.
9. **Begehung:** WASD + Maus, Pointer-Lock, Esc, Kollision, Augenhöhe, Türen passierbar, sauberes Input-Handling.
10. **Katalog:** Kategorien (Sofas … Deko), Suche/Filter, Platzieren/Drehen/Maße/Duplizieren/Löschen,
    Metadaten (ID, Maße, Quelle, Preis, Modell, Material, Transform, URLs), GLB/glTF mit Fallback,
    Näherungen ehrlich kennzeichnen, kein Riesen-Download beim Start.
11. **IKEA Österreich / Möbelix Österreich:** nur legale, wartbare Quellen (offizielle API/Feeds →
    öffentlich erlaubte Daten → Nutzerdaten → kuratierte Beispiele); nichts erfinden; Integrationen getrennt vom Kern.
12. **Küchenplaner:** Unter-/Ober-/Hochschränke, Arbeitsplatten, Spüle, Geräte, Maße, Ausrichtung,
    Kollision, Fronten/Farben, Stückliste/Kosten; nur Entwurfshilfe (keine Normprüfung).
13. **Materialien & Licht:** Wandfarben, Böden, PBR, Texturmaßstab in realen Einheiten, Tageszeit,
    Innenlicht warm/kalt, Belichtung, optionale bessere Schatten/AO.
14. **Leistung:** Planungs- und Realismusmodus, adaptive Qualität ohne Flackern, Instancing/Wiederverwendung,
    Dispose, progressives Laden, kein Komplett-Neuaufbau bei Kleinigkeiten, Tests klein/mittel/groß, Grenzen dokumentieren.
15. **Speichern/Portabilität:** neu/speichern/laden/Autosave/Export/Import, alte Versionen, Assets nicht verlieren, kein Backend nötig.
16. **Budget:** Preise, Mengen, Summen, fehlende Preise, Kategorien, Einkaufsliste nach Kategorie/Händler, CSV,
    Schätzung vs. bestätigt.
17. **UX:** Werkzeuge links, Arbeitsfläche Mitte, Eigenschaften rechts, Toolbar oben, Statusleiste unten;
    keine toten Buttons, Leerzustände, Tooltips, Kürzel, Lade-/Fehlerzustände, Bestätigung bei Löschen.
18. **Tests:** Modell, Einheiten, Wandgeometrie, 2D↔3D, Transformationen, JSON, Versionen, Datei-Import,
    Kalibrierung, Fehlerfälle, Persistenz, Budget, kritische Interaktionen; echte Skripte ausführen.
19. **Phasen 0–8** (Fundament → Import → Bearbeiten/Begehung → Möbel/Rendering → Produkte → Küche →
    Persistenz/Budget → Stabilisierung), jeweils lauffähig.
20. **Definition of Done je Phase:** implementiert, Tests/Typecheck/Build gelaufen, Fehler behoben, README/Doku,
    Commit, Push, Git-Status geprüft, Bericht.

---

## Teil B – Ergänzung: Arbeitsweise, Git, Status, Produkt-Integrationen

1. **Effizient arbeiten:** kleine, prüfbare Teilaufgaben; nur nötige Dateien lesen; gezielte Tests während
   der Entwicklung, breite Prüfungen an Meilensteinen; knappe Berichte; keine unnötigen parallelen Agenten
   oder fremden Refactorings; Tests nie zum Sparen weglassen. Bei knappem Kontext Entscheidungen, Phase,
   geänderte Dateien, Testergebnisse, offene Punkte sichern; nach Kontextverdichtung Fakten an Repo und
   Git-Historie prüfen. Nie annehmen, dass ein früherer Build/Commit/Deploy gelungen ist, ohne Nachprüfung.
2. **Häufige, kleine, sinnvolle Commits** (`feat:`, `fix:`, `test:`, `perf:`, `docs:`), jeweils nach
   relevanten Checks; Themen getrennt halten; pushen, wenn erlaubt; Branch-Management selbstständig;
   nie Force-Push/History-Rewrite/Löschen fremder Branches/Merge/Sicherheitseinstellungen ohne Freigabe;
   keine Secrets oder generierten Artefakte committen; Erfolge nur nach Prüfung melden.
3. **Status-Dashboard `docs/PROJECT_STATUS.md`:** Status `DONE`, `PARTIAL`, `IN PROGRESS`, `PLANNED`,
   `BLOCKED`, `NEEDS USER TEST`; getrennt nach Implementierung / automatischer Prüfung / manueller Prüfung /
   Nutzerbestätigung (Nutzerbestätigung nur, wenn der Nutzer es ausdrücklich sagt). Inhalt: Phase, aktive
   Aufgabe, was funktioniert (mit Beleg), Teil-/laufende Features, nächste Aufgaben, Test-/Build-Ergebnisse,
   offene Nutzertests, bestätigte Features, Bugs/Grenzen/Blocker, Branch/Commits/Push-Status, nächster Schritt.
   Nach Meilensteinen und vor Sitzungsende aktualisieren.
4. **Fortschritt sichern:** Entscheidungen/Konventionen/Integrationsbefunde in Doku; zu Sitzungsbeginn
   Dashboard, Git-Status, letzte Commits prüfen; nichts doppelt implementieren; Blocker dokumentieren und weiterarbeiten.
5. **IKEA Österreich und Möbelix Österreich – praktische Tests:** Quellen ermitteln (offizielle Doku/APIs,
   Feeds/Affiliate, strukturierte Daten, Produktseiten, Artikelnummern, Maße, Preise, Bilder, Varianten,
   Verfügbarkeit, 3D-Modelle, Registrierung/Lizenzen); kleine, zurückhaltende Experimente (Statuscodes,
   Schemas, CORS, Bilder/3D laden, Maße vergleichen, Aktualität, Fehlerfälle); keine Umgehung von
   Rate-Limits, Bot-Schutz, Authentifizierung; Befunde als `VERIFIED` / `PARTIALLY VERIFIED` / `UNVERIFIED` /
   `UNAVAILABLE`; modulares Provider-System mit normalisiertem Produktmodell (Anbieter, ID, Artikelnummer,
   Maße mit Einheit, Preis/Währung, URLs, Varianten, Abrufzeitpunkt, Qualitätsstatus, Lizenzhinweise);
   nie Daten erfinden; Ausfälle dürfen den Planer nicht stören; Ergebnisse in `docs/INTEGRATIONS_IKEA.md`;
   bei gangbarem Weg kleiner End-to-End-Proof-of-Concept.
6. **Definition of Done:** implementiert, Checks gelaufen und korrekt dokumentiert, Grenzen dokumentiert,
   Dashboard aktualisiert, fokussierter Commit, Push geprüft, knapper Bericht (Änderungen, Tests, Commit-IDs,
   Push-Status, nächste Schritte).
