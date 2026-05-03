# Feature: Chameleon Blinking Eyes

The chameleon should naturally blink (open and close eyes) to feel alive instead of staring constantly.

## Behavior

- **Random idle blinks:** every 2-5 seconds (uniform random) the chameleon blinks once.
- **Double blink:** 15% chance the blink is followed by a second blink ~150ms later.
- **Blink shape:** eye scales vertically from `1.0` -> `0.05` -> `1.0` over a total of 150ms (75ms close, 75ms open). Use ease-in-out for both halves.
- **Both eyes blink in sync** (no winking).
- **Pause blinking** while:
  - In `SuperJump` state
  - In high combo (combo tier >= Insane)
  - The eyes should stay wide open and glow bright during these moments.
- **Resume blinking** automatically when the state returns to Idle/Walk/Jump/Fall.
- **First blink delay** after game start: random 1-2s (so it doesn't blink immediately on spawn).

## Implementation Guidance

The Player already has `eyeGlowLeft` and `eyeGlowRight` Graphics (white circles with `GlowFilter`) inside a parent container that follows the sprite.

### Approach A (preferred): scale the eye Graphics directly

```typescript
// In Player.ts
private blinkTimer = 0;
private nextBlinkAt = 1 + Math.random();
private isBlinking = false;
private blinkPhase: "closing" | "opening" | null = null;
private blinkPhaseTimer = 0;
private pendingDoubleBlink = false;

// Inside update(dt) - after state machine logic:
if (this.shouldPauseBlinking()) {
  this.eyeGlowLeft.scale.y = 1;
  this.eyeGlowRight.scale.y = 1;
  this.blinkTimer = 0;
  this.scheduleNextBlink();
  return;
}

if (!this.isBlinking) {
  this.blinkTimer += dt;
  if (this.blinkTimer >= this.nextBlinkAt) {
    this.startBlink();
  }
} else {
  this.updateBlink(dt);
}
```

### Blink phases

```typescript
private startBlink() {
  this.isBlinking = true;
  this.blinkPhase = "closing";
  this.blinkPhaseTimer = 0;
}

private updateBlink(dt: number) {
  this.blinkPhaseTimer += dt;
  const PHASE_MS = 0.075; // 75ms in seconds
  const t = Math.min(this.blinkPhaseTimer / PHASE_MS, 1);
  const eased = this.easeInOut(t);

  if (this.blinkPhase === "closing") {
    const scale = 1 - eased * 0.95; // 1.0 -> 0.05
    this.setEyeScaleY(scale);
    if (t >= 1) {
      this.blinkPhase = "opening";
      this.blinkPhaseTimer = 0;
    }
  } else if (this.blinkPhase === "opening") {
    const scale = 0.05 + eased * 0.95; // 0.05 -> 1.0
    this.setEyeScaleY(scale);
    if (t >= 1) {
      this.finishBlink();
    }
  }
}

private finishBlink() {
  this.setEyeScaleY(1);
  this.isBlinking = false;
  this.blinkPhase = null;

  if (this.pendingDoubleBlink) {
    this.pendingDoubleBlink = false;
    this.nextBlinkAt = 0.15;
    this.blinkTimer = 0;
  } else {
    if (Math.random() < 0.15) {
      this.pendingDoubleBlink = true;
    }
    this.scheduleNextBlink();
  }
}

private scheduleNextBlink() {
  this.nextBlinkAt = 2 + Math.random() * 3; // 2-5 seconds
  this.blinkTimer = 0;
}

private setEyeScaleY(s: number) {
  this.eyeGlowLeft.scale.y = s;
  this.eyeGlowRight.scale.y = s;
}

private easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

private shouldPauseBlinking(): boolean {
  if (this.state === PlayerState.SuperJump) return true;
  if (this.comboTier && this.comboTier >= ComboTier.Insane) return true;
  return false;
}
```

### Eye anchor for vertical scale

Make sure the eye Graphics has its pivot/anchor set so the scale.y collapse happens around the **center** of the eye, not from the top:

```typescript
// In Player constructor, when creating eyes:
this.eyeGlowLeft.pivot.set(0, 0);
// Graphics drawn with circle(0, 0, r) is already centered on origin - no change needed.
```

If for any reason the eye is drawn with `circle(cx, cy, r)` where `cx,cy != 0`, redraw it with `circle(0, 0, r)` and use `position.set(...)` to place it.

## Edge Cases

- **Game pause:** if you have a pause state, freeze `blinkTimer` while paused.
- **GameOver scene:** stop blinking (eyes stay wide open, X-shaped if you want a death look - optional).
- **Tongue cast:** keep blinking running normally (don't pause).
- **First spawn:** `nextBlinkAt = 1 + Math.random()` so first blink is between 1-2s after spawn.

## Tuning Knobs

Add to `src/config/game.config.ts`:

```typescript
export const BLINK = {
  minIntervalSec: 2,
  maxIntervalSec: 5,
  closeDurationSec: 0.075,
  openDurationSec: 0.075,
  doubleBlinkChance: 0.15,
  doubleBlinkGapSec: 0.15,
  closedScale: 0.05,
  firstBlinkMinSec: 1,
  firstBlinkMaxSec: 2,
};
```

Then reference these constants in the code above.

## Files to Modify

- **Modify:** `src/game/entities/Player.ts` (add blink fields and methods, call updateBlink in update loop)
- **Modify (or create):** `src/config/game.config.ts` (add BLINK constants)

## Verification After Implementation

After running the game:
1. The chameleon should blink within the first 1-2 seconds after spawn.
2. While idle, blinks should occur every few seconds at varying intervals.
3. Each blink should be quick and natural (~150ms total).
4. Sometimes you should see a double blink.
5. During a super-jump or big combo, eyes should stay wide open and glow stronger.
6. After the moment passes, blinking should resume.

## Output Required

Provide the complete updated `Player.ts` file (full content), the updated `game.config.ts` file, and a brief 2-3 sentence note describing what changed. Do not provide diffs - provide complete files. Do not break any existing functionality (tongue, eye glow, walking, state machine).
