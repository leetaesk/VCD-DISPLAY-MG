/* FM100 (simplified to 16 caps) — hue ring, anchor at 0 and N-1. */

export const FM100_COUNT = 16;
export const FM_ANCHOR_LEFT = 0;
export const FM_ANCHOR_RIGHT = FM100_COUNT - 1;
export const FM100_NORMAL_THRESHOLD = 20;

export const FM100_COLORS: [number, number, number][] = [];
for (let i = 0; i < FM100_COUNT; i++) {
  FM100_COLORS.push(hslToRgb(i / FM100_COUNT, 0.55, 0.55));
}

export function makeShuffledOrder(): number[] {
  const middle: number[] = [];
  for (let i = 1; i < FM100_COUNT - 1; i++) middle.push(i);
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middle[i], middle[j]] = [middle[j], middle[i]];
  }
  return [FM_ANCHOR_LEFT, ...middle, FM_ANCHOR_RIGHT];
}

/** sum |order[i] - i| 거리. 완벽 정렬 = 0. */
export function computeFM100Error(order: number[]): number {
  let err = 0;
  for (let i = 0; i < order.length; i++) err += Math.abs(order[i] - i);
  return err;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
