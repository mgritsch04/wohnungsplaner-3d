import { guessSockets } from './guessSockets';
import { FIXTURE_ELEVATION, fixtureSize, RADIATOR_DEFAULT, snapFixtureToWall } from '../model/fixtures';
import { newId } from '../model/ids';
import type { Fixture, FixtureKind } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

/** Editing operations of the installation plan (#64, #81); each is one undo step. */

const store = () => useProjectStore.getState();

/** New fixture of this kind on the wall next to `at`; null (with a hint) when no wall is near. */
export function placeFixture(kind: FixtureKind, at: Vec2): string | null {
  const base: Omit<Fixture, 'id' | 'x' | 'y' | 'rotation'> = {
    kind,
    elevation: FIXTURE_ELEVATION[kind],
    count: 1,
    ...(kind === 'radiator' ? { width: RADIATOR_DEFAULT.width, height: RADIATOR_DEFAULT.height } : {}),
  };
  const snap = snapFixtureToWall(store().project, base, at);
  if (!snap) {
    useUiStore.getState().toast('Bitte auf oder nahe an eine Wand klicken', 'info');
    return null;
  }
  const id = newId('fix');
  store().apply((d) => {
    d.fixtures.push({ id, ...base, x: snap.x, y: snap.y, rotation: snap.rotation });
  });
  useUiStore.getState().setSelection({ type: 'fixture', id });
  return id;
}

export function updateFixture(id: string, fn: (f: Fixture) => void) {
  store().apply((d) => {
    const f = d.fixtures.find((x) => x.id === id);
    if (!f) return;
    const before = fixtureSize(f).depth;
    fn(f);
    if (f.kind === 'radiator') {
      f.width ??= RADIATOR_DEFAULT.width;
      f.height ??= RADIATOR_DEFAULT.height;
    }
    // keep the back on the wall face when the depth changes (other kind)
    const shift = (fixtureSize(f).depth - before) / 2;
    if (shift) {
      f.x = Math.round((f.x - Math.sin(f.rotation) * shift) * 1000) / 1000;
      f.y = Math.round((f.y + Math.cos(f.rotation) * shift) * 1000) / 1000;
    }
  });
}

export function deleteFixture(id: string) {
  store().apply((d) => {
    d.fixtures = d.fixtures.filter((f) => f.id !== id);
  });
}

/** „Steckdosen raten“ (#374): propose sockets for the current plan and add them as one undo step. */
export function guessAndPlaceSockets(): number {
  const found = guessSockets(store().project);
  if (!found.length) {
    useUiStore.getState().toast('Keine Steckdosen zu raten – Räume fehlen, oder es gibt schon genug.', 'info');
    return 0;
  }
  store().apply((d) => {
    d.fixtures.push(...found);
  });
  useUiStore.getState().toast(`${found.length} Steckdose(n) geraten und als „geraten“ markiert – bitte prüfen. Rückgängig mit Strg+Z.`, 'success');
  return found.length;
}
