import { Assets, Rectangle, Texture } from 'pixi.js';

const GAME_ASSETS = `${import.meta.env.BASE_URL}assets`;

/** Single sheet — both skill buttons (`public/assets/objects/skill-buttons.png`). */
export const SKILL_BUTTONS_SHEET_URL = `${GAME_ASSETS}/objects/skill-buttons.png`;

const SKILL_BUTTONS_SHEET_KEY = 'skillButtonsSheet';

/** Pre-measured opaque bounds for the shipped 1024×1536 sheet (side-by-side center band). */
const SKILL_SHEET_CONTENT_FRAME = Object.freeze({
  x: 30,
  y: 610,
  width: 964,
  height: 250,
});

export type SkillButtonTextures = {
  superJump: Texture;
  pullUp: Texture;
};

let skillSheetRegistered = false;

function registerSkillSheetAsset(): void {
  if (skillSheetRegistered) {
    return;
  }
  Assets.add({ alias: SKILL_BUTTONS_SHEET_KEY, src: SKILL_BUTTONS_SHEET_URL });
  skillSheetRegistered = true;
}

/** Warm the PNG in the browser cache. */
export function preloadSkillButtonAssets(): void {
  registerSkillSheetAsset();
  void Assets.load(SKILL_BUTTONS_SHEET_KEY);
}

function resolveContentFrame(sheet: Texture): Rectangle {
  const w = Math.max(1, sheet.width);
  const h = Math.max(1, sheet.height);

  if (w === 1024 && h === 1536) {
    return new Rectangle(
      SKILL_SHEET_CONTENT_FRAME.x,
      SKILL_SHEET_CONTENT_FRAME.y,
      SKILL_SHEET_CONTENT_FRAME.width,
      SKILL_SHEET_CONTENT_FRAME.height,
    );
  }

  // Wide sheet: buttons fill the frame edge-to-edge horizontally.
  if (w >= h) {
    return new Rectangle(0, 0, w, h);
  }

  // Tall sheet with side-by-side buttons: center horizontal band (~16% of height).
  const bandH = Math.max(1, Math.round(h * 0.16));
  const bandY = Math.max(0, Math.round((h - bandH) * 0.5));
  return new Rectangle(0, bandY, w, bandH);
}

/**
 * Crop the combined sheet into two textures (left = SUPER JUMP, right = PULL UP).
 * The shipped art is a tall PNG with both buttons side-by-side in a center band — not stacked.
 */
export function cropSkillButtonTextures(sheet: Texture): SkillButtonTextures {
  sheet.source.scaleMode = 'linear';
  const content = resolveContentFrame(sheet);
  const halfW = Math.max(1, Math.floor(content.width * 0.5));

  return {
    superJump: new Texture({
      source: sheet.source,
      frame: new Rectangle(content.x, content.y, halfW, content.height),
    }),
    pullUp: new Texture({
      source: sheet.source,
      frame: new Rectangle(
        content.x + halfW,
        content.y,
        Math.max(1, content.width - halfW),
        content.height,
      ),
    }),
  };
}

/** Load `skill-buttons.png` and return cropped frames; `null` only on hard failure. */
export async function loadSkillButtonTextures(): Promise<SkillButtonTextures | null> {
  try {
    registerSkillSheetAsset();
    const sheet = await Assets.load<Texture>(SKILL_BUTTONS_SHEET_KEY);
    const textures = cropSkillButtonTextures(sheet);
    if (import.meta.env.DEV) {
      console.info('[skillButtons] loaded', {
        sheet: `${sheet.width}x${sheet.height}`,
        superJump: `${textures.superJump.width}x${textures.superJump.height}`,
        pullUp: `${textures.pullUp.width}x${textures.pullUp.height}`,
        url: SKILL_BUTTONS_SHEET_URL,
      });
    }
    return textures;
  } catch (err) {
    console.warn('[skillButtons] failed to load skill HUD sheet', SKILL_BUTTONS_SHEET_URL, err);
    return null;
  }
}
