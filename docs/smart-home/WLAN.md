# WLAN-Planung (#253, #354, #492)

Wo: Reiter **Smart Home › WLAN-Abdeckung**, Farbschicht im 2D-Plan. Code: `src/smarthome/wifi.ts` (Signal, Wände, Geräteklassen), `src/smarthome/wifiPlan.ts` (Datenrate, Kanäle, Nachbarnetze, Repeater/Mesh, eigene Geräte, Vorschläge), UI `WifiPanel.tsx`, `WifiOverlay2D.tsx`, `WifiMarkers2D.tsx`.

## Was geht
- **Zugangspunkte** frei setzen: Router, Mesh-Knoten, Repeater, Access Point (Kabel). Je Gerät WLAN-Standard (4/5/6/6E/7, daraus Bänder und Höchstrate), Antennen, Kanal (oder automatisch), Kanalbreite, Verbindung (Kabel, eigenes Funkband, gleicher Funk) und an welchem Gerät es hängt. Eigener Modellname nur als Text, keine Produktdaten.
- **Farbschicht**: Datenrate, Signalstärke oder Störung durch Nachbar-WLANs; je Band oder bestes Band. Wert unter dem Mauszeiger.
- **Wände** dämpfen nach eingetragener Bauart (Gipskarton, Porenbeton, Ziegel, Beton), sonst nach Dicke; schräg getroffene Wände stärker; geschlossene Türen/Fenster.
- **Nachbar-WLANs**: Name, Band, Kanal, Breite, Stockwerk, Nutzung, optional gemessene Stärke mit Messpunkt (kalibriert die Schätzung). Wirkung: geteilte Sendezeit auf gleichem Kanal, Rauschen bei überlappenden 2,4-GHz-Kanälen. Kanal-Rat je Zugangspunkt.
- **Eigene Geräte** (Handy, Laptop, PC, TV, Konsole, Smart-Home mit WLAN …) mit Bedarf in Mbit/s: je Gerät „reicht / reicht nicht“ mit Begründung und Rat (LAN-Kabel, Mesh). WLAN-Smart-Home-Geräte aus der Geräteliste zählen automatisch mit. Nicht versorgte Geräte erscheinen im Wohnungs-Check.
- **Vorschlag** „Wo hinstellen?“ für Mesh-Knoten, Repeater oder Access Point (bis zu zwei, mit Übernehmen); Hinweis, wenn ein anderer Router-Platz deutlich mehr abdeckt.

## Grenzen (ehrlich)
Schätzung, keine Messung: gerade Linie, keine Reflexionen, Decken nur für Nachbarn darüber/darunter, Sendeleistung = EU-Grenze ohne Datenblattwert, Bedarfe und Nutzung der Nachbarnetze sind Annahmen. Ein echter Messrundgang mit dem Handy bleibt der Maßstab.
