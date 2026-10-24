/**
 * Stage 4 of the new furnishing pipeline (mgritsch04/wohnungsplaner-3d#441): the walk-through.
 * Asks of every furnished room „würde das jemand so einrichten?“ with the rules A–E of the
 * plan (docs/EINRICHTUNG_NEU.md): findings with severity, plain text, the pieces concerned and a
 * place in the plan, plus points (score.ts) and key figures. Deterministic, no Claude call.
 */
import type { Finding, RoomMetrics, RoomReview, Review } from '../types';
import { flatScore, passes, roomScore } from '../score';
import { checkAnchors, checkDoubles, checkKitchen, checkRequired, checkSanitary } from './functionRules';
import { checkClearances, checkDoors, checkReach, checkWays } from './wayRules';
import { checkBeds, checkDesk, checkDining, checkSeating, checkTall, checkTv, checkWallFit, checkWedged } from './arrangeRules';
import { checkCurtains, checkLight, checkPictures, checkPlants, checkRepeats, checkRugs } from './decorRules';
import { checkBalance, checkFocus, checkOpenPatch, checkOccupancy, checkPalette, checkTogether, checkZones, occupancy } from './overallRules';
import { RoomCtx, type ReviewInput } from './context';

export type { ReviewInput, ReviewOptions } from './context';

const ORDER = { S: 0, M: 1, L: 2 } as const;

function run(ctx: RoomCtx): RoomReview {
  checkRequired(ctx);
  checkSanitary(ctx);
  checkKitchen(ctx);
  checkAnchors(ctx);
  const walks = checkWays(ctx);
  checkDoors(ctx);
  checkClearances(ctx);
  checkReach(ctx);
  checkBeds(ctx);
  checkSeating(ctx);
  checkTv(ctx);
  checkDining(ctx);
  checkDesk(ctx);
  checkTall(ctx);
  checkWallFit(ctx);
  checkWedged(ctx);
  checkPlants(ctx);
  checkLight(ctx);
  checkRugs(ctx);
  checkPictures(ctx);
  checkCurtains(ctx);
  checkRepeats(ctx);
  checkOccupancy(ctx);
  checkBalance(ctx);
  checkOpenPatch(ctx);
  checkZones(ctx);
  checkTogether(ctx);
  checkPalette(ctx);
  checkFocus(ctx);
  const findings = [...ctx.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const metrics: RoomMetrics = { occupancy: occupancy(ctx), ...walks, dropped: ctx.layout.dropped.length };
  return { roomId: ctx.roomId, findings, score: roomScore(findings), passed: passes(findings), metrics };
}

/** Walk-through of one furnished room (rules A1, A3–A5, B, C, D, E; A2 needs the whole flat). */
export function reviewRoom(input: ReviewInput): RoomReview {
  return run(new RoomCtx(input));
}

/** Walk-through of all rooms of a flat, with the findings about the flat itself (A2). */
export function reviewFlat(inputs: ReviewInput[]): Review {
  const ctxs = inputs.map((i) => new RoomCtx(i));
  const rooms = ctxs.map(run);
  const flat: Finding[] = checkDoubles(ctxs);
  const { score, minScore } = flatScore(rooms);
  return { rooms, flat, score, minScore, passed: rooms.every((r) => r.passed) && !flat.some((f) => f.severity === 'S') };
}
