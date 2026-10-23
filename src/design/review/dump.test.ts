import { it } from 'vitest';
import { derivePlan } from '../../model/derived';
import { pointInPolygon } from '../../model/vec';
import { analyzeFlat } from '../analysis';
import { TEST_FLATS } from '../fixtures/flats';
import heute from './fixtures/heute.json';
import { reviewFlat } from './index';
it('dump', () => {
  for (const key of ['A', 'B'] as const) {
    const project = TEST_FLATS[key].build();
    const analysis = analyzeFlat(project, derivePlan(project));
    const rec = (heute as any)[key];
    const inputs = analysis.rooms.map((room) => ({
      analysis: room, type: rec[room.name].type,
      layout: { roomId: room.roomId, items: rec[room.name].items.map((i: any, n: number) => ({ ...i, id: `${room.name}-${n}`, zone: 'h' })), dropped: [], cost: 0, unsolved: [], seed: 0 },
      existing: project.furniture.filter((f) => f.existing && pointInPolygon(f, room.polygon)).map((f) => ({ id: f.id, catalogId: f.catalogId ?? '', zone: 'b', x: f.x, y: f.y, rotation: f.rotation, elevation: f.elevation, width: f.width, depth: f.depth, height: f.height })),
    }));
    const r = reviewFlat(inputs as any);
    let out = `\n=== ${key} score ${r.score} min ${r.minScore}\n`;
    for (const room of r.rooms) { const nm = analysis.rooms.find((a) => a.roomId === room.roomId)!.name; out += `-- ${nm}: ${room.score} ${room.passed ? 'ok' : 'NICHT'} occ ${room.metrics.occupancy.toFixed(2)}\n`; for (const f of room.findings) out += `   ${f.rule}${f.severity} ${f.text}\n`; }
    for (const f of r.flat) out += `FLAT ${f.rule}${f.severity} ${f.text}\n`;
    console.log(out);
  }
});
