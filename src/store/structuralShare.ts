/**
 * Structural sharing for project updates (#231).
 *
 * Every change works on a full copy of the project (structuredClone), so before #231 every object in
 * it was new after each change – also walls, rooms and every piece of furniture the change did not
 * touch. Carrying one chair in the walkthrough rebuilt all wall and floor geometry and re-rendered
 * every piece of furniture on every frame. `shareUnchanged` puts the untouched parts of the old
 * project back into the copy: what is equal to before is the same object as before, so memoized
 * views (and React.memo) skip it.
 *
 * `next` must be a fresh copy owned by the caller: it is modified in place.
 */
export function shareUnchanged<T>(base: T, next: T): T {
  return share(base, next) as T;
}

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function idOf(v: unknown): string | undefined {
  return isPlainObject(v) && typeof v.id === 'string' ? v.id : undefined;
}

function share(base: unknown, next: unknown): unknown {
  if (Object.is(base, next)) return base;
  if (Array.isArray(base) && Array.isArray(next)) {
    // elements with an id are matched by id, so removing or inserting one keeps the others
    const byId = new Map<string, unknown>();
    for (const b of base) {
      const id = idOf(b);
      if (id !== undefined) byId.set(id, b);
    }
    let same = base.length === next.length;
    for (let i = 0; i < next.length; i++) {
      const id = idOf(next[i]);
      const b = id !== undefined && byId.has(id) ? byId.get(id) : i < base.length ? base[i] : undefined;
      next[i] = b === undefined ? next[i] : share(b, next[i]);
      if (next[i] !== base[i]) same = false;
    }
    return same ? base : next;
  }
  if (isPlainObject(base) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(base).length;
    for (const k of keys) {
      if (!(k in base)) {
        same = false;
        continue;
      }
      next[k] = share(base[k], next[k]);
      if (next[k] !== base[k]) same = false;
    }
    return same ? base : next;
  }
  return next;
}
