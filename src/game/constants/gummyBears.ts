/** Side gummy names — column order in `public/assets/Player staff/gummy.png` (left → right). */
export const GUMMY_BEAR_NAMES = ['Red Berry', 'Mint Pop', 'Blue Burst'] as const;

export type GummyBearName = (typeof GUMMY_BEAR_NAMES)[number];

export function isGummyBearName(value: string): value is GummyBearName {
  return (GUMMY_BEAR_NAMES as readonly string[]).includes(value);
}

export function gummyBearNameFromIndex(bearIndex: number): GummyBearName {
  const idx = ((bearIndex % GUMMY_BEAR_NAMES.length) + GUMMY_BEAR_NAMES.length) % GUMMY_BEAR_NAMES.length;
  return GUMMY_BEAR_NAMES[idx];
}

/** Accent tint per gummy — used for popup glow + particles. */
export function gummyBearAccentColor(name: GummyBearName): number {
  switch (name) {
    case 'Red Berry':
      return 0xff6688;
    case 'Mint Pop':
      return 0x66ffaa;
    case 'Blue Burst':
      return 0x6699ff;
    default:
      return 0xffcc66;
  }
}
