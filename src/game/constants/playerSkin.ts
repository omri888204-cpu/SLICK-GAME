/** Playable runner spritesheet id (distinct from onboarding `selectedCharacterId`). */
export const PLAYER_SKIN = {
  NINJA_SLICK: 'NINJA_SLICK',
} as const;

export type PlayerSkinName = (typeof PLAYER_SKIN)[keyof typeof PLAYER_SKIN];

export const DEFAULT_PLAYER_SKIN: PlayerSkinName = PLAYER_SKIN.NINJA_SLICK;

export function normalizeSelectedCharacterSkin(raw: unknown): PlayerSkinName {
  if (raw === PLAYER_SKIN.NINJA_SLICK) {
    return raw;
  }
  return DEFAULT_PLAYER_SKIN;
}

const BASE_URL = import.meta.env.BASE_URL;
export const PLAYABLE_STAFF = `${BASE_URL}assets/${encodeURIComponent('Player staff')}/`;

/** Original chameleon ninja — 8 cols × 7 rows, 100×40 px. */
export function characterSpritesheetPlayableUrl(): string {
  return `${PLAYABLE_STAFF}${encodeURIComponent('character_spritesheet.png')}`;
}
