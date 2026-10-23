/** Minimal one-page vector PDF (1:100, 28.3465 pt per metre) built from plan-metre path commands – synthetic plans for the user-test scenarios. */
export const M = 28.3465;
const OX = 100;
const OY = 100;
const K = 0.5523; // bezier circle constant
const f = (v) => v.toFixed(2);
const px = (x) => f(OX + x * M);
const py = (y) => f(OY + y * M);

export const line = (x1, y1, x2, y2) => `${px(x1)} ${py(y1)} m ${px(x2)} ${py(y2)} l S`;
export const circle = (cx, cy, r) =>
  `${px(cx + r)} ${py(cy)} m ` +
  `${px(cx + r)} ${py(cy + K * r)} ${px(cx + K * r)} ${py(cy + r)} ${px(cx)} ${py(cy + r)} c ` +
  `${px(cx - K * r)} ${py(cy + r)} ${px(cx - r)} ${py(cy + K * r)} ${px(cx - r)} ${py(cy)} c ` +
  `${px(cx - r)} ${py(cy - K * r)} ${px(cx - K * r)} ${py(cy - r)} ${px(cx)} ${py(cy - r)} c ` +
  `${px(cx + K * r)} ${py(cy - r)} ${px(cx + r)} ${py(cy - K * r)} ${px(cx + r)} ${py(cy)} c S`;
/** Filled rectangle in grey (0 = black … 1 = white), like drywall drawn only as an area. */
export const fillRect = (x0, y0, x1, y1, grey = 0.85) => `${grey} g ${px(x0)} ${py(y0)} ${f((x1 - x0) * M)} ${f((y1 - y0) * M)} re f 0 g`;
/** Text label (Helvetica) at a plan point. */
export const text = (x, y, str, size = 10) => `BT /F1 ${size} Tf ${px(x)} ${py(y)} Td (${str}) Tj ET`;
/** Ellipse (four béziers). */
export const oval = (cx, cy, rx, ry) =>
  `${px(cx + rx)} ${py(cy)} m ` +
  `${px(cx + rx)} ${py(cy + K * ry)} ${px(cx + K * rx)} ${py(cy + ry)} ${px(cx)} ${py(cy + ry)} c ` +
  `${px(cx - K * rx)} ${py(cy + ry)} ${px(cx - rx)} ${py(cy + K * ry)} ${px(cx - rx)} ${py(cy)} c ` +
  `${px(cx - rx)} ${py(cy - K * ry)} ${px(cx - K * rx)} ${py(cy - ry)} ${px(cx)} ${py(cy - ry)} c ` +
  `${px(cx + K * rx)} ${py(cy - ry)} ${px(cx + rx)} ${py(cy - K * ry)} ${px(cx + rx)} ${py(cy)} c S`;
/** Rectangle with rounded corners (radius r), straight edges as lines, corners as béziers. */
export function roundedRect(cx, cy, w, h, r) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return (
    `${px(x0 + r)} ${py(y0)} m ${px(x1 - r)} ${py(y0)} l ` +
    `${px(x1 - r + K * r)} ${py(y0)} ${px(x1)} ${py(y0 + r - K * r)} ${px(x1)} ${py(y0 + r)} c ${px(x1)} ${py(y1 - r)} l ` +
    `${px(x1)} ${py(y1 - r + K * r)} ${px(x1 - r + K * r)} ${py(y1)} ${px(x1 - r)} ${py(y1)} c ${px(x0 + r)} ${py(y1)} l ` +
    `${px(x0 + r - K * r)} ${py(y1)} ${px(x0)} ${py(y1 - r + K * r)} ${px(x0)} ${py(y1 - r)} c ${px(x0)} ${py(y0 + r)} l ` +
    `${px(x0)} ${py(y0 + r - K * r)} ${px(x0 + r - K * r)} ${py(y0)} ${px(x0 + r)} ${py(y0)} c h S`
  );
}
/** Quarter arc (door swing) around centre (cx, cy) from angle a0 to a0 + 90° (plan angles, y down), one bézier. */
export function quarterArc(cx, cy, r, a0) {
  const k = 0.5523 * r;
  const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = -s0, s1 = c0; // end direction = start rotated by +90°
  const p0 = { x: cx + r * c0, y: cy + r * s0 };
  const p3 = { x: cx + r * c1, y: cy + r * s1 };
  const p1 = { x: p0.x - k * s0, y: p0.y + k * c0 };
  const p2 = { x: p3.x + k * s1, y: p3.y - k * c1 };
  return `${px(p0.x)} ${py(p0.y)} m ${px(p1.x)} ${py(p1.y)} ${px(p2.x)} ${py(p2.y)} ${px(p3.x)} ${py(p3.y)} c S`;
}
export const poly = (pts) => pts.map((p, i) => `${px(p.x)} ${py(p.y)} ${i ? 'l' : 'm'}`).join(' ') + ' h S';

/** Room 5 × 4 m, walls 20 cm (outline of each wall as two lines, like a CAD export). */
export function roomWalls(t = 0.1) {
  return [
    line(-t, -t, 5 + t, -t), line(t, t, 5 - t, t),
    line(-t, 4 + t, 5 + t, 4 + t), line(t, 4 - t, 5 - t, 4 - t),
    line(-t, -t, -t, 4 + t), line(t, t, t, 4 - t),
    line(5 + t, -t, 5 + t, 4 + t), line(5 - t, t, 5 - t, 4 - t),
  ];
}
export const symbols = {
  socket: (cx, cy, r = 0.1) => [circle(cx, cy, r), line(cx - r, cy, cx + r, cy)],
  sw: (cx, cy, r = 0.08) => [circle(cx, cy, r), line(cx + r, cy, cx + 3 * r, cy + 2 * r)],
  water: (cx, cy, r = 0.08) => {
    const k = r / Math.SQRT2;
    return [circle(cx, cy, r), line(cx - k, cy - k, cx + k, cy + k), line(cx - k, cy + k, cx + k, cy - k)];
  },
  lan: (cx, cy, s = 0.2) => [poly([{ x: cx - s / 2, y: cy + s / 2 }, { x: cx + s / 2, y: cy + s / 2 }, { x: cx, y: cy - s / 2 }])],
  radiator: (cx, cy, l = 1.0, w = 0.1) => [poly([{ x: cx - l / 2, y: cy - w / 2 }, { x: cx + l / 2, y: cy - w / 2 }, { x: cx + l / 2, y: cy + w / 2 }, { x: cx - l / 2, y: cy + w / 2 }])],
};

export function pdfOf(commands) {
  const plan = ['0.8 w 0 G', ...commands].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${plan.length} >>\nstream\n${plan}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
