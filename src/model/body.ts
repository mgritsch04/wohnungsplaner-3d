/**
 * Body height of the person walking through the plan (#263). It is set instead of the eye height:
 * the eyes are about 11 cm below the top of the head, seated they are at about 74 % of the
 * body height (seat ≈ 45 cm plus the upper body).
 */
export const BODY_HEIGHT_DEFAULT = 1.63;
export const BODY_HEIGHT_MIN = 1.1;
export const BODY_HEIGHT_MAX = 2.3;
export const EYE_BELOW_TOP = 0.11;
const SEATED_EYE_SHARE = 0.74;

const cm = (m: number) => Math.round(m * 100) / 100;

/** Standing eye height (m) for a body height (m). */
export const eyeFromBody = (body: number): number => cm(body - EYE_BELOW_TOP);
/** Seated eye height (m) for a body height (m). */
export const seatedEyeFromBody = (body: number): number => cm(body * SEATED_EYE_SHARE);

/**
 * Settings saved before #263 have an eye height instead of a body height. The old default
 * (163 cm eye height) becomes the default body height; a deliberately changed eye height becomes
 * that eye height plus 11 cm, so the view stays where it was.
 */
export function migrateBodyHeight(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const s = raw as Record<string, unknown>;
  if (typeof s.bodyHeight === 'number' || typeof s.eyeHeight !== 'number') return raw;
  const eye = s.eyeHeight;
  const body = Math.abs(eye - 1.63) < 1e-6 ? BODY_HEIGHT_DEFAULT : cm(eye + EYE_BELOW_TOP);
  return { ...s, bodyHeight: Math.max(BODY_HEIGHT_MIN, Math.min(BODY_HEIGHT_MAX, body)) };
}
