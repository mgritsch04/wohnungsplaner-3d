import type { SmartDeviceKind } from '../model/schema';

/**
 * Device catalog for the smart-home simulation (#170)
 * ----------------------------------------------------
 * Only values a source states are entered (see `sources`); missing values stay undefined
 * and the simulation then uses the clearly marked ASSUMPTIONS below. `sourceKind` says
 * whether the values come from the manufacturer or only from retailer/press pages
 * (researched 2026-10-17; check before buying). `router` is a Zigbee/Thread mesh router:
 * `stated` = a source says so, `inferred` = derived from mains power only.
 */
export interface DeviceProduct {
  id: string;
  brand: string;
  model: string;
  kind: SmartDeviceKind;
  protocol: 'Zigbee' | 'Thread/Matter' | 'Wi-Fi';
  power: string;
  batteryLife?: string;
  rangeM?: number;
  angleDeg?: number;
  lumen?: number;
  kelvin?: [number, number];
  router: 'stated' | 'inferred' | 'no' | 'unknown';
  sourceKind: 'manufacturer' | 'retailer';
  sources: string[];
  note?: string;
  /** Price range in € (min, max) where docs/smart-home/HARDWARE_AND_DEVICES.md states one (Stand 2026-10-16, check before buying); absent = unknown. */
  priceEur?: [number, number];
}

export const DEVICE_PRODUCTS: DeviceProduct[] = [
  {
    id: 'ikea-vallhorn',
    brand: 'IKEA',
    model: 'VALLHORN Bewegungsmelder',
    kind: 'motion',
    protocol: 'Zigbee',
    power: '2× AAA (LADDA, 1,2 V)',
    rangeM: 5,
    angleDeg: 120,
    router: 'no',
    priceEur: [10, 10],
    sourceKind: 'manufacturer',
    sources: ['https://ikea.com/sg/en/p/vallhorn-wireless-motion-sensor-smart-white-70504342', 'https://www.ikea.is/static/web/ikea4/pdfs/advice/en/360/AA-2398360-3_pub.pdf'],
    note: 'Reichweite 5 m für Bewegung, Winkel laut Datenblatt 60–120°.',
  },
  {
    id: 'sonoff-snzb-03p',
    brand: 'SONOFF',
    model: 'SNZB-03P Bewegungsmelder',
    kind: 'motion',
    protocol: 'Zigbee',
    power: '1× CR2477',
    batteryLife: 'bis 3 Jahre',
    rangeM: 6,
    angleDeg: 110,
    router: 'no',
    sourceKind: 'retailer',
    sources: ['https://openelab.io/products/sonoff-zigbee-motion-sensor-snzb-03p'],
    note: 'Andere Händler nennen bis 7 m.',
  },
  {
    id: 'hue-motion-indoor',
    brand: 'Philips Hue',
    model: 'Hue Bewegungsmelder (innen)',
    kind: 'motion',
    protocol: 'Zigbee',
    power: '2× AAA',
    batteryLife: 'ca. 2 Jahre',
    rangeM: 5,
    angleDeg: 100,
    router: 'no',
    sourceKind: 'retailer',
    sources: ['https://galaxus.ch/en/s4/product/philips-hue-motion-sensor-5-m-motion-sensors-5893079'],
    note: 'Winkel je nach Händler 100° oder 120°.',
  },
  {
    id: 'aqara-fp1e',
    brand: 'Aqara',
    model: 'Presence Sensor FP1E (PS-S03D)',
    kind: 'presence',
    protocol: 'Zigbee',
    power: 'USB-C 5 V',
    rangeM: 6,
    angleDeg: 120,
    router: 'unknown',
    sourceKind: 'retailer',
    sources: ['https://mightygadget.com/aqara-presence-sensor-fp1e-review/'],
    note: 'mmWave: erkennt auch ruhende Personen.',
  },
  {
    id: 'sonoff-snzb-06p',
    brand: 'SONOFF',
    model: 'SNZB-06P Präsenzsensor',
    kind: 'presence',
    protocol: 'Zigbee',
    power: 'USB-C 5 V',
    rangeM: 4,
    router: 'stated',
    priceEur: [17.58, 17.58],
    sourceKind: 'retailer',
    sources: ['https://cnx-software.com/?p=119622'],
    note: 'Reichweite 2,5–4 m je nach Empfindlichkeit; Winkel nicht angegeben.',
  },
  {
    id: 'ikea-myggbett',
    brand: 'IKEA',
    model: 'MYGGBETT Tür-/Fensterkontakt',
    kind: 'contact',
    protocol: 'Thread/Matter',
    power: '1× AAA (LADDA)',
    router: 'no',
    priceEur: [7.99, 7.99],
    sourceKind: 'retailer',
    sources: ['https://csa-iot.org/csa_product/myggbett-door-window-sensor-2/'],
  },
  {
    id: 'sonoff-snzb-04p',
    brand: 'SONOFF',
    model: 'SNZB-04P Tür-/Fensterkontakt',
    kind: 'contact',
    protocol: 'Zigbee',
    power: '1× CR2477',
    batteryLife: 'über 5 Jahre (Herstellerschätzung)',
    router: 'no',
    priceEur: [10, 15],
    sourceKind: 'manufacturer',
    sources: ['https://sonoff.tech/en-eu/products/sonoff-zigbee-door-window-sensor-snzb-04p'],
  },
  {
    id: 'ikea-kajplats-1055',
    brand: 'IKEA',
    model: 'KAJPLATS E27 1055 lm, White Spectrum',
    kind: 'light',
    protocol: 'Thread/Matter',
    power: 'Netz (E27)',
    lumen: 1055,
    kelvin: [2200, 6500],
    router: 'inferred',
    priceEur: [4.99, 4.99],
    sourceKind: 'manufacturer',
    sources: ['https://www.ikea.com/gb/en/p/-10611298/'],
  },
  {
    id: 'ikea-inspelning',
    brand: 'IKEA',
    model: 'INSPELNING Steckdose mit Verbrauchsmessung',
    kind: 'plug',
    protocol: 'Zigbee',
    power: 'Netz, 16 A',
    router: 'stated',
    sourceKind: 'retailer',
    sources: ['https://www.zigbee2mqtt.io/devices/E22xx.html', 'https://csa-iot.org/csa_product/inspelning-smart-plug/'],
  },
];

/**
 * ASSUMPTIONS (no datasheet value): used when neither the device nor its product gives a
 * value. Shown as "Annahme" in the panel.
 */
export const ASSUMED = {
  rangeM: 5,
  angleDeg: 110,
  /** motion/presence sensor reports "no motion" this long after the last detection */
  holdS: 60,
} as const;

export const KIND_LABEL: Record<SmartDeviceKind, string> = {
  motion: 'Bewegungsmelder',
  presence: 'Präsenzsensor',
  contact: 'Tür-/Fensterkontakt',
  light: 'Smarte Lampe',
  plug: 'Smarte Steckdose',
  router: 'Router / Access Point',
  strip: 'LED-Streifen',
  speaker: 'Lautsprecher',
  blind: 'Jalousie-/Vorhang-Antrieb',
};

export const productById = (id: string | undefined): DeviceProduct | undefined => (id ? DEVICE_PRODUCTS.find((p) => p.id === id) : undefined);

/** Default mounting height (m) per kind. */
export const DEFAULT_ELEVATION: Record<SmartDeviceKind, number> = { motion: 2.1, presence: 2.1, contact: 1.2, light: 2.3, plug: 0.3, router: 1.5, strip: 0.9, speaker: 1, blind: 2.2 };
