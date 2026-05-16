/**
 * Removes baked black / circular matte backdrops from loot PNGs.
 * Targets separate files: gold.png, DIAMOND.png, MUSHROOM.png (same logic as the old 3-column strip).
 *
 * Usage: node scripts/clean-loot-sheet.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAFF_DIR = path.join(__dirname, '..', 'public', 'assets', 'Player staff');
/** Files must match `MenuScene` / `PlayScene` URLs (case-sensitive on Linux deploy). */
const LOOT_FILES = ['gold.png', 'DIAMOND.png', 'MUSHROOM.png'];

/** Fully transparent when max channel is at/below this (baked black mat). */
const BLACK_SOLID = 20;
/** Feather dark fringe around removed black (prevents jagged circle edge). */
const BLACK_SOFT_RANGE = 44;
/**
 * Inside this normalized radius from each column's center, extra-aggressive removal for
 * near-black disk pixels (handles gray anti-alias on the circular matte).
 */
const CIRCLE_RIM = 0.5;

/**
 * @param {Buffer} data RGBA
 * @param {number} columns 3 for old horizontal strip, 1 for standalone icons
 */
function processMatteRemoval(data, width, height, columns) {
  const fw = width / columns;
  if (!Number.isInteger(fw)) {
    throw new Error(`Width ${width} not divisible by ${columns} columns`);
  }
  const radiusRef = Math.min(fw, height) * 0.5;

  const out = Buffer.from(data);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fi = Math.floor(x / fw);
      const lx = x - fi * fw + 0.5 - fw * 0.5;
      const ly = y + 0.5 - height * 0.5;
      const distN = Math.hypot(lx, ly) / radiusRef;

      const i = (y * width + x) * 4;
      const a = out[i + 3];

      const mx = Math.max(out[i], out[i + 1], out[i + 2]);

      let alphaMul = 1;

      if (mx <= BLACK_SOLID) {
        alphaMul = 0;
      } else if (mx <= BLACK_SOLID + BLACK_SOFT_RANGE) {
        alphaMul *= (mx - BLACK_SOLID) / BLACK_SOFT_RANGE;
      }

      if (distN < CIRCLE_RIM && mx <= BLACK_SOLID + BLACK_SOFT_RANGE + 12) {
        const disk = 1 - distN / CIRCLE_RIM;
        const extra = disk * disk * (1 - (mx - BLACK_SOLID) / (BLACK_SOFT_RANGE + 18));
        alphaMul *= Math.max(0, Math.min(1, 1 - Math.max(0, extra)));
      }

      const na = Math.max(0, Math.min(255, Math.round(a * alphaMul)));
      out[i + 3] = na;
    }
  }

  return out;
}

async function cleanOneFile(absPath, columns) {
  const img = sharp(absPath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(`Expected RGBA, got ${info.channels} channels`);
  }

  const processed = processMatteRemoval(data, info.width, info.height, columns);

  await sharp(processed, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(absPath);

  console.log(`Wrote cleaned loot: ${absPath} (${info.width}x${info.height})`);
}

async function main() {
  if (!fs.existsSync(STAFF_DIR)) {
    throw new Error(`Missing ${STAFF_DIR}`);
  }

  for (const file of LOOT_FILES) {
    const abs = path.join(STAFF_DIR, file);
    if (!fs.existsSync(abs)) {
      console.warn(`Skip missing loot file: ${abs}`);
      continue;
    }
    await cleanOneFile(abs, 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
