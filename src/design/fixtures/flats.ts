/**
 * Six invented test flats for the new furnishing pipeline (#436), each with the wishes of its
 * (invented) residents and what a careful reading of the plan says about every room. Stage 0
 * checks its analysis against `rooms`, the benchmark runs the whole pipeline on all six.
 *
 * A and B are the flats of the first analysis (23.10.2026) and must stay unchanged, so new runs
 * stay comparable with that baseline. No real flat, no personal data.
 */
import { EMPTY_WISHES, type DesignWishes } from '../../assistant/design';
import type { Project } from '../../model/schema';
import type { RoomType } from '../types';
import { door, existingKitchen, finish, fixture, fixtureAt, newFlat, outline, passage, room, wall, window, zone } from './build';

export type FlatKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** What a careful reading of the plan says about a room. */
export interface RoomTruth {
  /** Room types a sensible concept may give it. */
  types: RoomType[];
  /** Doors and passages in its walls, the entrance and balcony doors included. */
  doors: number;
  /** Windows in its walls; a window to the balcony counts for both rooms. */
  windows: number;
  /** Corners of the interior outline (4 = rectangle) … */
  corners: number;
  /** … and how many of them stick into the room (L-shape, bay shoulders). */
  reflex?: number;
  /** Lies on a shortest door route from the entrance to another room. */
  passThrough?: boolean;
}

export interface TestFlat {
  key: FlatKey;
  title: string;
  /** What the flat puts to the test. */
  tests: string;
  wishes: DesignWishes;
  /** Name of the room with the entrance door. */
  entrance: string;
  /** By room name. */
  rooms: Record<string, RoomTruth>;
  build: () => Project;
}

const wishes = (w: Partial<DesignWishes>): DesignWishes => ({ ...EMPTY_WISHES, searchReal: false, ...w });

/** Wishes of the first analysis, used for A and B. */
const READER_COOK_GAMER = wishes({
  interests: 'Lesen\nKochen\nPC-Spiele',
  needs: 'Arbeitsplatz mit Monitor\nviel Stauraum\nSchlafplatz für Gäste',
  wants: 'gemütliche Leseecke\nPflanzen\nEsstisch für 4',
  style: 'skandinavisch',
});

const thin = { thickness: 0.12, height: 2.6 };

/** A: 3 Zimmer, langer Gang, Bad und WC getrennt, Küche mit Essplatz, Balkon vor dem Wohnzimmer (~78 m²). */
function buildA(): Project {
  const p = newFlat('Testwohnung A');
  room(p, 'Wohnzimmer', [[0, 0], [5.4, 0], [5.4, 4.2], [0, 4.2]], thin);
  room(p, 'Küche', [[5.4, 0], [8.8, 0], [8.8, 4.2], [5.4, 4.2]], thin);
  room(p, 'Zimmer 1', [[8.8, 0], [12, 0], [12, 4.2], [8.8, 4.2]], thin);
  room(p, 'Gang', [[3.8, 4.2], [12, 4.2], [12, 5.6], [3.8, 5.6]], thin);
  room(p, 'Abstellraum', [[3.8, 5.6], [5.4, 5.6], [5.4, 7.2], [3.8, 7.2]], thin);
  room(p, 'Bad', [[5.4, 5.6], [7.8, 5.6], [7.8, 8.4], [5.4, 8.4]], thin);
  room(p, 'WC', [[7.8, 5.6], [8.9, 5.6], [8.9, 7.3], [7.8, 7.3]], thin);
  room(p, 'Zimmer 2', [[8.9, 5.6], [12, 5.6], [12, 9], [8.9, 9]], thin);
  room(p, 'Balkon', [[0.8, -1.6], [4.6, -1.6], [4.6, 0], [0.8, 0]], thin);
  door(p, [3.8, 4.9], 1.0, [4.5, 4.9]); // Wohnungstür
  door(p, [4.6, 4.2], 0.9, [4.6, 3.5]); // Wohnzimmer
  door(p, [6.1, 4.2], 0.8, [6.1, 3.5]); // Küche
  door(p, [9.4, 4.2], 0.8, [9.4, 3.5]); // Zimmer 1
  door(p, [4.6, 5.6], 0.7, [4.6, 4.9]); // Abstellraum, schlägt in den Gang auf
  door(p, [6.0, 5.6], 0.8, [6.0, 6.3]); // Bad
  door(p, [8.35, 5.6], 0.7, [8.35, 4.9]); // WC, nach außen
  door(p, [9.6, 5.6], 0.8, [9.6, 6.3]); // Zimmer 2
  door(p, [3.7, 0], 0.9, [3.7, 0.7]); // Balkontür
  window(p, [1.8, 0], 1.4);
  window(p, [0, 2.2], 1.2);
  window(p, [7.1, 0], 1.2);
  window(p, [10.4, 0], 1.2);
  window(p, [10.45, 9], 1.2);
  fixtureAt(p, 'generic-bathtub', 6.6, 7.955, Math.PI);
  fixtureAt(p, 'generic-washbasin', 7.5, 6.6, Math.PI / 2);
  fixtureAt(p, 'generic-toilet', 8.35, 6.96, Math.PI);
  return finish(p, 'A');
}

/** B: kleine 2-Zimmer-Wohnung mit Wohnküche als Durchgangszimmer zum Schlafzimmer, Bad mit WC, Vorraum, Balkon (~49 m²). */
function buildB(): Project {
  const p = newFlat('Testwohnung B');
  room(p, 'Vorraum', [[0, 0], [2.2, 0], [2.2, 2.4], [0, 2.4]], thin);
  room(p, 'Bad', [[0, 2.4], [2.2, 2.4], [2.2, 5.0], [0, 5.0]], thin);
  room(p, 'Wohnküche', [[2.2, 0], [8.2, 0], [8.2, 4.4], [2.2, 4.4]], thin);
  room(p, 'Schlafzimmer', [[2.2, 4.4], [6.2, 4.4], [6.2, 8.0], [2.2, 8.0]], thin);
  room(p, 'Balkon', [[5.4, -1.5], [8.2, -1.5], [8.2, 0], [5.4, 0]], thin);
  door(p, [0, 1.2], 1.0, [0.8, 1.2]); // Wohnungstür
  door(p, [1.4, 2.4], 0.8, [1.4, 3.2]); // Bad
  door(p, [2.2, 1.0], 0.9, [3.0, 1.0]); // Wohnküche
  door(p, [2.9, 4.4], 0.8, [2.9, 5.2]); // Schlafzimmer, aus der Wohnküche
  door(p, [7.4, 0], 0.9, [7.4, 0.8]); // Balkontür
  window(p, [4.2, 0], 1.4);
  window(p, [8.2, 2.4], 1.2);
  window(p, [4.2, 8.0], 1.2);
  fixtureAt(p, 'generic-shower', 0.52, 4.48, Math.PI);
  fixtureAt(p, 'generic-toilet', 0.34, 3.4, -Math.PI / 2);
  fixtureAt(p, 'generic-washbasin', 1.9, 4.2, Math.PI / 2);
  return finish(p, 'B');
}

/** C: Familie, 4 Zimmer, L-förmiger Wohn-Essraum mit Küche dahinter, zwei Kinderzimmer, L-förmiger Vorraum (~116 m²). */
function buildC(): Project {
  const p = newFlat('Testwohnung C');
  const inner = { thickness: 0.12, height: 2.6 };
  outline(p, [[0, 0], [14, 0], [14, 9.2], [0, 9.2]], { thickness: 0.3, height: 2.6 });
  room(p, 'Wohn-Essraum', [[0, 0], [7, 0], [7, 4.2], [3.4, 4.2], [3.4, 6.4], [0, 6.4]], inner);
  room(p, 'Küche', [[0, 6.4], [3.4, 6.4], [3.4, 9.2], [0, 9.2]], inner);
  room(p, 'Elternschlafzimmer', [[7, 0], [10.6, 0], [10.6, 4.2], [7, 4.2]], inner);
  room(p, 'Kinderzimmer 1', [[10.6, 0], [14, 0], [14, 4.2], [10.6, 4.2]], inner);
  room(p, 'Vorraum', [[3.4, 4.2], [14, 4.2], [14, 7.2], [10.8, 7.2], [10.8, 5.6], [3.4, 5.6]], inner);
  room(p, 'Bad', [[3.4, 5.6], [6.6, 5.6], [6.6, 9.2], [3.4, 9.2]], inner);
  room(p, 'Kinderzimmer 2', [[6.6, 5.6], [10.8, 5.6], [10.8, 9.2], [6.6, 9.2]], inner);
  room(p, 'Abstellraum', [[10.8, 7.2], [12.4, 7.2], [12.4, 9.2], [10.8, 9.2]], inner);
  room(p, 'WC', [[12.4, 7.2], [14, 7.2], [14, 9.2], [12.4, 9.2]], inner);
  room(p, 'Balkon', [[1.2, -1.6], [5.6, -1.6], [5.6, 0], [1.2, 0]], { thickness: 0.12, height: 1.0 });
  door(p, [14, 5.4], 1.0, [13.3, 5.4]); // Wohnungstür
  door(p, [3.4, 4.9], 0.9, [2.8, 4.9]); // Wohn-Essraum
  door(p, [7.6, 4.2], 0.8, [7.6, 3.6]); // Eltern
  door(p, [11.2, 4.2], 0.8, [11.2, 3.6]); // Kinderzimmer 1
  door(p, [4.0, 5.6], 0.8, [4.0, 6.2]); // Bad
  door(p, [7.2, 5.6], 0.8, [7.2, 6.2]); // Kinderzimmer 2
  door(p, [11.6, 7.2], 0.7, [11.6, 6.6]); // Abstellraum, nach außen
  door(p, [13.2, 7.2], 0.7, [13.2, 6.6]); // WC, nach außen
  door(p, [4.8, 0], 0.9, [4.8, 0.7]); // Balkontür
  passage(p, [2.2, 6.4], 1.0); // Küche offen zum Essplatz
  window(p, [2.4, 0], 1.6);
  window(p, [6.3, 0], 1.0);
  window(p, [0, 2.0], 1.4);
  window(p, [0, 5.3], 1.2);
  window(p, [0, 7.8], 1.2);
  window(p, [8.8, 0], 1.4);
  window(p, [12.3, 0], 1.4);
  window(p, [5.0, 9.2], 0.9, { sillHeight: 1.2, height: 0.9 });
  window(p, [8.7, 9.2], 1.4);
  window(p, [13.2, 9.2], 0.5, { sillHeight: 1.5, height: 0.6 });
  fixture(p, 'Bad', 'generic-bathtub', 'W', 'end');
  fixture(p, 'Bad', 'generic-washbasin', 'O', 6.6);
  fixture(p, 'Bad', 'generic-shower', 'S', 'end');
  fixture(p, 'WC', 'generic-toilet', 'O', 8.4);
  fixture(p, 'WC', 'generic-washbasin', 'S', 12.8);
  return finish(p, 'C');
}

/** D: Garçonnière, ein Zimmer für Wohnen, Schlafen, Kochen und Essen, Vorraum, Bad mit WC (~28 m²). */
function buildD(): Project {
  const p = newFlat('Testwohnung D');
  const inner = { thickness: 0.12, height: 2.6 };
  outline(p, [[0, 0], [6.6, 0], [6.6, 4.8], [0, 4.8]], { thickness: 0.3, height: 2.6 });
  room(p, 'Zimmer', [[0, 0], [4.6, 0], [4.6, 4.8], [0, 4.8]], inner);
  room(p, 'Vorraum', [[4.6, 0], [6.6, 0], [6.6, 2.6], [4.6, 2.6]], inner);
  room(p, 'Bad', [[4.6, 2.6], [6.6, 2.6], [6.6, 4.8], [4.6, 4.8]], inner);
  door(p, [6.6, 1.3], 1.0, [6.0, 1.3]); // Wohnungstür
  door(p, [4.6, 1.6], 0.9, [4.0, 1.6]); // Zimmer
  door(p, [5.2, 2.6], 0.8, [5.2, 3.2]); // Bad
  window(p, [1.2, 0], 1.2);
  window(p, [3.3, 0], 1.2);
  fixture(p, 'Bad', 'generic-shower', 'S', 'end');
  fixture(p, 'Bad', 'generic-toilet', 'W', 4.2);
  fixture(p, 'Bad', 'generic-washbasin', 'O', 3.2);
  return finish(p, 'D');
}

/**
 * E: Altbau, dicke Außenmauern, Wohnzimmer mit schrägem Erker und vier Türen (Vorraum, zwei
 * Durchgangstüren in einer Flucht, Küche), Arbeitszimmer nur durch das Wohnzimmer erreichbar,
 * L-förmiger Vorraum (~100 m²).
 */
function buildE(): Project {
  const p = newFlat('Testwohnung E');
  const inner = { thickness: 0.15, height: 3.3 };
  const tall = { sillHeight: 0.85, height: 2.0 };
  outline(p, [[0, 0], [5.2, 0], [5.8, -1.0], [7.2, -1.0], [7.8, 0], [12.6, 0], [12.6, 9.0], [0, 9.0]], { thickness: 0.45, height: 3.3 });
  room(p, 'Schlafzimmer', [[0, 0], [4, 0], [4, 5.2], [0, 5.2]], inner);
  room(p, 'Wohnzimmer', [[4, 0], [5.2, 0], [5.8, -1.0], [7.2, -1.0], [7.8, 0], [9, 0], [9, 5.2], [4, 5.2]], inner);
  room(p, 'Arbeitszimmer', [[9, 0], [12.6, 0], [12.6, 5.2], [9, 5.2]], inner);
  room(p, 'Küche', [[7, 5.2], [12.6, 5.2], [12.6, 9.0], [7, 9.0]], inner);
  room(p, 'Vorraum', [[2.6, 5.2], [7, 5.2], [7, 9.0], [5.4, 9.0], [5.4, 7.0], [2.6, 7.0]], inner);
  room(p, 'Bad', [[0, 5.2], [2.6, 5.2], [2.6, 9.0], [0, 9.0]], inner);
  room(p, 'WC', [[2.6, 7.0], [4, 7.0], [4, 9.0], [2.6, 9.0]], inner);
  room(p, 'Abstellraum', [[4, 7.0], [5.4, 7.0], [5.4, 9.0], [4, 9.0]], inner);
  door(p, [6.2, 9.0], 1.0, [6.2, 8.3]); // Wohnungstür
  door(p, [5.6, 5.2], 1.1, [5.6, 4.5]); // Wohnzimmer
  door(p, [3.3, 5.2], 0.9, [3.3, 4.5]); // Schlafzimmer
  door(p, [4, 1.2], 1.1, [3.3, 1.2]); // Wohnzimmer → Schlafzimmer (Flucht)
  door(p, [9, 1.2], 1.1, [9.7, 1.2]); // Wohnzimmer → Arbeitszimmer (Flucht)
  door(p, [8.2, 5.2], 0.9, [8.2, 5.9]); // Wohnzimmer → Küche
  door(p, [7, 8.0], 0.9, [7.7, 8.0]); // Küche
  door(p, [2.6, 6.1], 0.8, [2.0, 6.1]); // Bad
  door(p, [3.3, 7.0], 0.7, [3.3, 6.4]); // WC, nach außen
  door(p, [4.7, 7.0], 0.7, [4.7, 6.4]); // Abstellraum, nach außen
  window(p, [2.0, 0], 1.2, tall);
  window(p, [6.5, -1.0], 1.0, tall);
  window(p, [5.5, -0.5], 0.6, tall);
  window(p, [7.5, -0.5], 0.6, tall);
  window(p, [10.8, 0], 1.2, tall);
  window(p, [12.6, 2.6], 1.2, tall);
  window(p, [8.8, 9.0], 1.2, tall);
  window(p, [11.2, 9.0], 1.2, tall);
  window(p, [1.3, 9.0], 0.9, { sillHeight: 1.2, height: 1.0 });
  window(p, [3.3, 9.0], 0.6, { sillHeight: 1.4, height: 0.8 });
  fixture(p, 'Bad', 'generic-bathtub', 'S', 'start');
  fixture(p, 'Bad', 'generic-washbasin', 'W', 6.0);
  fixture(p, 'WC', 'generic-toilet', 'S', 3.3);
  return finish(p, 'E');
}

/**
 * F: Neubau, offene Wohnküche mit vorhandener Einbauküche und Glaselement zur Loggia,
 * Schlafzimmer mit Schrankraum und eigenem Bad, zweites Bad am Vorraum, Speis, ein markierter
 * Bereich „frei lassen“ und ein Leseplatz (~92 m²).
 */
function buildF(): Project {
  const p = newFlat('Testwohnung F');
  const inner = { thickness: 0.12, height: 2.7 };
  outline(p, [[0, 0], [11.8, 0], [11.8, 8.6], [0, 8.6]], { thickness: 0.3, height: 2.7 });
  room(p, 'Zimmer 2', [[0, 0], [4, 0], [4, 3.8], [0, 3.8]], inner);
  room(p, 'Vorraum', [[4, 0], [7, 0], [7, 3.8], [4, 3.8]], inner);
  room(p, 'Bad 1', [[7, 0], [9.4, 0], [9.4, 2.4], [7, 2.4]], inner);
  room(p, 'Schrankraum', [[9.4, 0], [11.8, 0], [11.8, 2.4], [9.4, 2.4]], inner);
  room(p, 'Schlafzimmer', [[7, 2.4], [11.8, 2.4], [11.8, 6.6], [7, 6.6]], inner);
  room(p, 'Wohnküche', [[0, 3.8], [7, 3.8], [7, 8.6], [0, 8.6]], inner);
  room(p, 'Speis', [[7, 6.6], [8.4, 6.6], [8.4, 8.6], [7, 8.6]], inner);
  room(p, 'Bad 2', [[8.4, 6.6], [11.8, 6.6], [11.8, 8.6], [8.4, 8.6]], inner);
  wall(p, [0.6, 8.6], [0.6, 10.4], inner);
  wall(p, [5.0, 8.6], [5.0, 10.4], inner);
  room(p, 'Loggia', [[0.6, 8.6], [5.0, 8.6], [5.0, 10.4], [0.6, 10.4]], { thickness: 0.12, height: 1.0 });
  door(p, [5.5, 0], 1.0, [5.5, 0.7]); // Wohnungstür
  door(p, [4, 2.9], 0.8, [3.4, 2.9]); // Zimmer 2
  door(p, [5.6, 3.8], 0.9, [5.6, 4.5]); // Wohnküche
  door(p, [7, 1.9], 0.8, [7.6, 1.9]); // Bad 1
  door(p, [7, 3.1], 0.8, [7.6, 3.1]); // Schlafzimmer
  door(p, [10.6, 2.4], 0.8, [10.6, 1.8]); // Schrankraum
  door(p, [9.2, 6.6], 0.8, [9.2, 7.2]); // Bad 2
  door(p, [7, 7.6], 0.7, [6.4, 7.6]); // Speis, schlägt in die Wohnküche auf
  door(p, [4.2, 8.6], 1.0, [4.2, 8.0]); // Loggia
  window(p, [0, 1.9], 1.4);
  window(p, [0, 6.0], 1.6);
  window(p, [2.2, 8.6], 2.0, { sillHeight: 0, height: 2.2 }); // Glaselement bis zum Boden
  window(p, [11.8, 4.5], 1.6);
  window(p, [10.4, 8.6], 0.8, { sillHeight: 1.4, height: 0.8 });
  fixture(p, 'Bad 1', 'generic-shower', 'N', 'end');
  fixture(p, 'Bad 1', 'generic-toilet', 'S', 8.9);
  fixture(p, 'Bad 1', 'generic-washbasin', 'N', 7.6);
  fixture(p, 'Bad 2', 'generic-bathtub', 'S', 'end');
  fixture(p, 'Bad 2', 'generic-washbasin', 'N', 10.5);
  fixture(p, 'Bad 2', 'generic-toilet', 'W', 8.0);
  existingKitchen(p, [2, 3.8], [2, 4.5], [0, 3.8], [
    ['generic-k-fridge'],
    ['generic-k-wall-60', 'generic-k-drawer-60'],
    ['generic-k-hood-60', 'generic-k-cooktop', 'generic-k-oven'],
    ['generic-k-wall-80', 'generic-k-sink-80'],
    ['generic-k-dishwasher'],
    ['generic-k-base-40'],
  ]);
  zone(p, 'frei lassen (Yogamatte)', [0.25, 5.1], [2.05, 6.9]);
  zone(p, 'Leseplatz', [10.2, 3.6], [11.6, 5.4]);
  return finish(p, 'F');
}

export const TEST_FLATS: Record<FlatKey, TestFlat> = {
  A: {
    key: 'A',
    title: '3 Zimmer mit langem Gang',
    tests: 'Neutrale Zimmernamen (Zimmer 1/2), getrenntes WC ohne Handwaschbecken, Balkon nur über das Wohnzimmer, Gästeschlafplatz und Esstisch nur einmal.',
    wishes: READER_COOK_GAMER,
    entrance: 'Gang',
    build: buildA,
    rooms: {
      Wohnzimmer: { types: ['living'], doors: 2, windows: 2, corners: 4, passThrough: true },
      Küche: { types: ['kitchen'], doors: 1, windows: 1, corners: 4 },
      'Zimmer 1': { types: ['bedroom', 'office'], doors: 1, windows: 1, corners: 4 },
      Gang: { types: ['hall'], doors: 8, windows: 0, corners: 4, passThrough: true },
      Abstellraum: { types: ['utility'], doors: 1, windows: 0, corners: 4 },
      Bad: { types: ['bath'], doors: 1, windows: 0, corners: 4 },
      WC: { types: ['bath'], doors: 1, windows: 0, corners: 4 },
      'Zimmer 2': { types: ['office', 'bedroom'], doors: 1, windows: 1, corners: 4 },
      Balkon: { types: ['balcony'], doors: 1, windows: 1, corners: 4 },
    },
  },
  B: {
    key: 'B',
    title: '2 Zimmer mit Wohnküche als Durchgangszimmer',
    tests: 'Drei Türen in der Wohnküche (Vorraum, Schlafzimmer, Balkon), deren Wege frei bleiben müssen; Küchenzeile neben Fenster und Balkontür; kleines Bad mit WC.',
    wishes: READER_COOK_GAMER,
    entrance: 'Vorraum',
    build: buildB,
    rooms: {
      Vorraum: { types: ['hall'], doors: 3, windows: 0, corners: 4, passThrough: true },
      Bad: { types: ['bath'], doors: 1, windows: 0, corners: 4 },
      Wohnküche: { types: ['kitchen', 'living'], doors: 3, windows: 2, corners: 4, passThrough: true },
      Schlafzimmer: { types: ['bedroom'], doors: 1, windows: 1, corners: 4 },
      Balkon: { types: ['balcony'], doors: 1, windows: 0, corners: 4 },
    },
  },
  C: {
    key: 'C',
    title: 'Familie, 4 Zimmer, L-förmiger Wohn-Essraum',
    tests: 'L-förmiger Wohn-Essraum mit offener Küche dahinter (Weg zur Küche frei), zwei Kinderzimmer, Esstisch für 6, Homeoffice-Platz ohne eigenes Zimmer, L-förmiger Vorraum mit acht Türen, dickere Außenwände.',
    wishes: wishes({
      interests: 'Brettspiele\nBasteln mit den Kindern\nKochen am Wochenende',
      needs: 'Esstisch für 6\nzwei Kinderzimmer (6 und 9 Jahre) mit Bett, Schreibtisch und Spielfläche\nHomeoffice-Platz für einen Elternteil (2 Tage pro Woche)\nviel Stauraum für Spielsachen',
      wants: 'gemütliche Sofaecke für alle vier\nPflanzen\nSpielecke im Wohnzimmer',
      style: 'gemütlich',
      colors: 'warme Erdtöne, Holz',
    }),
    entrance: 'Vorraum',
    build: buildC,
    rooms: {
      'Wohn-Essraum': { types: ['living', 'dining'], doors: 3, windows: 4, corners: 6, reflex: 1, passThrough: true },
      Küche: { types: ['kitchen'], doors: 1, windows: 1, corners: 4 },
      Elternschlafzimmer: { types: ['bedroom'], doors: 1, windows: 1, corners: 4 },
      'Kinderzimmer 1': { types: ['kids'], doors: 1, windows: 1, corners: 4 },
      Vorraum: { types: ['hall'], doors: 8, windows: 0, corners: 6, reflex: 1, passThrough: true },
      Bad: { types: ['bath'], doors: 1, windows: 1, corners: 4 },
      'Kinderzimmer 2': { types: ['kids'], doors: 1, windows: 1, corners: 4 },
      Abstellraum: { types: ['utility'], doors: 1, windows: 0, corners: 4 },
      WC: { types: ['bath'], doors: 1, windows: 1, corners: 4 },
      Balkon: { types: ['balcony'], doors: 1, windows: 1, corners: 4 },
    },
  },
  D: {
    key: 'D',
    title: 'Garçonnière, 28 m²',
    tests: 'Ein Raum für Schlafen, Wohnen, Kochen und Essen: klare Zonen statt Gedränge, Kochnische ohne vorhandene Küche, richtiges Bett statt Schlafsofa, kleines Budget.',
    wishes: wishes({
      interests: 'Kochen\nYoga\nLesen',
      needs: 'richtiges Bett 140, kein Schlafsofa\nKochnische (noch keine Küche vorhanden)\nEssplatz für 2\nArbeitsplatz für den Laptop',
      wants: 'ruhig und aufgeräumt\nPflanzen',
      style: 'minimalistisch',
      colors: 'Weiß, Sand, helles Holz',
      budget: 3500,
    }),
    entrance: 'Vorraum',
    build: buildD,
    rooms: {
      Zimmer: { types: ['living', 'bedroom'], doors: 1, windows: 2, corners: 4 },
      Vorraum: { types: ['hall'], doors: 3, windows: 0, corners: 4, passThrough: true },
      Bad: { types: ['bath'], doors: 1, windows: 0, corners: 4 },
    },
  },
  E: {
    key: 'E',
    title: 'Altbau mit Erker und Durchgangstüren',
    tests: 'Wohnzimmer mit vier Türen und schrägem Erker (nicht rechteckig), Arbeitszimmer nur durch das Wohnzimmer erreichbar, Küche mit zwei Türen, 45 cm dicke Außenmauern und hohe Räume.',
    wishes: wishes({
      interests: 'Musik hören (Plattenspieler)\nLesen\nGäste bewirten',
      needs: 'Bücherwand\nArbeitszimmer mit Schreibtisch und Gästebett\nEsstisch für 6',
      wants: 'Altbau-Charme betonen\nLeseplatz im Erker\nPflanzen',
      style: 'modern',
      colors: 'Altweiß, dunkles Holz, Messing',
    }),
    entrance: 'Vorraum',
    build: buildE,
    rooms: {
      Schlafzimmer: { types: ['bedroom'], doors: 2, windows: 1, corners: 4 },
      Wohnzimmer: { types: ['living', 'dining'], doors: 4, windows: 3, corners: 8, reflex: 2, passThrough: true },
      Arbeitszimmer: { types: ['office'], doors: 1, windows: 2, corners: 4 },
      Küche: { types: ['kitchen', 'dining'], doors: 2, windows: 2, corners: 4 },
      Vorraum: { types: ['hall'], doors: 7, windows: 0, corners: 6, reflex: 1, passThrough: true },
      Bad: { types: ['bath'], doors: 1, windows: 1, corners: 4 },
      WC: { types: ['bath'], doors: 1, windows: 1, corners: 4 },
      Abstellraum: { types: ['utility'], doors: 1, windows: 0, corners: 4 },
    },
  },
  F: {
    key: 'F',
    title: 'Neubau mit offener Wohnküche und Schlafzimmer-Suite',
    tests: 'Vorhandene Einbauküche (keine zweite planen), Glaselement bis zum Boden, markierter Bereich „frei lassen“ und Leseplatz, Schlafzimmer als Durchgang zu Schrankraum und eigenem Bad, zwei Bäder, Homeoffice ganztags.',
    wishes: wishes({
      interests: 'Kochen für Gäste\nYoga\nSerien schauen',
      needs: 'Homeoffice ganztags in Zimmer 2 mit zwei Monitoren\nEsstisch für 6 bis 8\nFernseher\nPlatz für die Yogamatte frei lassen',
      wants: 'großzügig und hell\nPflanzen',
      style: 'industriell',
      colors: 'Beton, Schwarz, warmes Holz',
    }),
    entrance: 'Vorraum',
    build: buildF,
    rooms: {
      'Zimmer 2': { types: ['office', 'bedroom', 'kids'], doors: 1, windows: 1, corners: 4 },
      Vorraum: { types: ['hall'], doors: 5, windows: 0, corners: 4, passThrough: true },
      'Bad 1': { types: ['bath'], doors: 1, windows: 0, corners: 4 },
      Schrankraum: { types: ['utility', 'other'], doors: 1, windows: 0, corners: 4 },
      Schlafzimmer: { types: ['bedroom'], doors: 3, windows: 1, corners: 4, passThrough: true },
      Wohnküche: { types: ['kitchen', 'living'], doors: 3, windows: 2, corners: 4, passThrough: true },
      Speis: { types: ['utility'], doors: 1, windows: 0, corners: 4 },
      'Bad 2': { types: ['bath'], doors: 1, windows: 1, corners: 4 },
      Loggia: { types: ['balcony'], doors: 1, windows: 1, corners: 4 },
    },
  },
};

export const FLAT_KEYS = Object.keys(TEST_FLATS) as FlatKey[];
