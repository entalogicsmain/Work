// The Comeback mark: an open "C" ring whose lower end turns into an upward arrow.
// Geometry is defined once here (1024 x 1024 canvas, glyph centred) and reused for every PNG and vector drawable.
export const BG = '#1C2629';
const R = 250, SW = 84, deg = Math.PI / 180;
const at = a => [512 + R * Math.cos(a * deg), 512 + R * Math.sin(a * deg)];
const P0 = at(-62), P1 = at(0);
const tan = [0, -1];                 // direction of travel at the arrow end
const tip = [P1[0] + tan[0] * 64, P1[1] + tan[1] * 64];
const rot = (v, a) => [v[0] * Math.cos(a * deg) - v[1] * Math.sin(a * deg), v[0] * Math.sin(a * deg) + v[1] * Math.cos(a * deg)];
const back = [-tan[0], -tan[1]];
const A = rot(back, 45), B = rot(back, -45), L = 158;
const arm = v => [tip[0] + v[0] * L, tip[1] + v[1] * L];
const f = n => Math.round(n * 10) / 10;
export const ARC = `M${f(P0[0])} ${f(P0[1])}A${R} ${R} 0 1 0 ${f(P1[0])} ${f(P1[1])}`;
export const HEAD = `M${f(arm(A)[0])} ${f(arm(A)[1])}L${f(tip[0])} ${f(tip[1])}L${f(arm(B)[0])} ${f(arm(B)[1])}`;
export const STROKE = SW;
// glyph bounds (approx, including stroke) so callers can centre and scale it
const pts = [P0, P1, tip, arm(A), arm(B), [512 - R, 512], [512, 512 - R], [512, 512 + R]];
export const BOUNDS = {
  x0: Math.min(...pts.map(p => p[0])) - SW / 2, x1: Math.max(...pts.map(p => p[0])) + SW / 2,
  y0: Math.min(...pts.map(p => p[1])) - SW / 2, y1: Math.max(...pts.map(p => p[1])) + SW / 2
};
/** SVG group for the glyph, centred on (cx,cy) with the given overall height in px. */
export function glyphSvg({ cx, cy, height, color = '#FFFFFF' }) {
  const b = BOUNDS, s = height / (b.y1 - b.y0);
  const gx = (b.x0 + b.x1) / 2, gy = (b.y0 + b.y1) / 2;
  return `<g transform="translate(${cx} ${cy}) scale(${s}) translate(${-gx} ${-gy})" fill="none" stroke="${color}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"><path d="${ARC}"/><path d="${HEAD}"/></g>`;
}
