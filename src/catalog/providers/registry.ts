import { pickIkeaModel } from './ikeaModels';
import type { ProductProviderInfo } from './types';

/**
 * Known retailers. Neither IKEA nor Möbelix offers a documented public product
 * API (see docs/INTEGRATIONS_IKEA.md), so live lookup is "unavailable" and data
 * comes from user-supplied pages/lists. Providers can be added independently.
 */
export const IKEA_AT: ProductProviderInfo = {
  id: 'ikea-at',
  label: 'IKEA Österreich',
  hosts: ['www.ikea.com', 'ikea.com'],
  liveLookup: 'unavailable',
  liveLookupNote: 'Keine offiziell dokumentierte öffentliche Produkt-API. Inoffizielle Endpunkte werden bewusst nicht genutzt.',
  articleNumberFromUrl: (url) => {
    // e.g. /at/de/p/billy-buecherregal-weiss-00263850/ or …-s49385862/ (8 digits, optional "s" for combinations)
    const m = url.pathname.match(/-(s?)(\d{8})\/?$/);
    if (!m) return null;
    const d = m[2];
    return `${m[1] ? 'S' : ''}${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  },
  pickModel: pickIkeaModel,
  modelFetchNote:
    'IKEA liefert die 3D-Dateien nur an Seiten von ikea.com aus (Browser-Sicherheit/CORS – geprüft 2026-10-16: andere Herkunft → HTTP 403). Das ist eine bewusste Sperre und wird nicht umgangen.',
  licenseNote: 'Produktbilder und 3D-Modelle sind urheberrechtlich geschützt; nur verlinken bzw. für den privaten Gebrauch nutzen, nicht weiterverbreiten.',
};

export const MOEBELIX_AT: ProductProviderInfo = {
  id: 'moebelix-at',
  label: 'Möbelix Österreich',
  hosts: ['www.moebelix.at', 'moebelix.at'],
  liveLookup: 'unavailable',
  liveLookupNote: 'Keine öffentliche API-Dokumentation gefunden; ein Affiliate-Produktfeed war gelistet, aber als geschlossen markiert.',
  licenseNote: 'Produktbilder sind urheberrechtlich geschützt; nur verlinken bzw. für den privaten Gebrauch nutzen.',
};

export const GENERIC_SHOP: ProductProviderInfo = {
  id: 'generic',
  label: 'Anderer Händler',
  hosts: [],
  liveLookup: 'unavailable',
  liveLookupNote: 'Daten aus eingefügter Produktseite oder manueller Eingabe.',
  licenseNote: 'Rechte an Bildern/Modellen liegen beim Händler bzw. Hersteller.',
};

export const PROVIDERS = [IKEA_AT, MOEBELIX_AT];

export function providerForUrl(raw: string | null | undefined): ProductProviderInfo {
  if (!raw) return GENERIC_SHOP;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return PROVIDERS.find((p) => p.hosts.includes(host)) ?? GENERIC_SHOP;
  } catch {
    return GENERIC_SHOP;
  }
}
