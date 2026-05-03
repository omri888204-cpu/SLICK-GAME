import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type Ticker,
} from 'pixi.js';
import { COMBO, GRAPPLE, SCORE_UI, STAIRS } from '../../config/game.config';
import { HyperScoreboard } from '../ui/HyperScoreboard';
import { Player } from '../entities/Player';
import { InputManager } from '../systems/InputManager';
import { Physics } from '../systems/Physics';
import type { ActiveGrapple, Platform, Ripple } from '../types';
import crystalPlatformUrl from '../../assets/sprites/crystal-platform.png';
import slimePlatformUrl from '../../assets/sprites/slime-platform.png';
import volcanoPlatformUrl from '../../assets/sprites/volcano-platform.png';
import stormPlatformUrl from '../../assets/sprites/storm-platform.png';
import type { Scene } from './Scene';

type ComboPopup = {
  label: Text;
  t: number;
  wx: number;
  wy: number;
};

type BeastParticle = {
  x: number;
  y: number;
  age: number;
};

const CHECKER_BACKGROUND_COLOR_SPREAD = 10;
/** Pixels at image edges this dark (and connected) are cleared — removes black letterbox around Photoroom exports. */
const DARK_BG_MAX_CHANNEL = 42;

export class PlayScene implements Scene {
  readonly name = 'play';

  private app?: Application;
  private input?: InputManager;
  private physics = new Physics();
  private world = new Container();
  private background = new Graphics();
  private jelly = new Graphics();
  private fxLayer = new Graphics();
  private platformSpriteLayer = new Container();
  private platformLayer = new Graphics();
  private rippleLayer = new Graphics();
  private gameShake = new Container();
  private tongueLayer = new Graphics();
  private player = new Player();
  private scoreboard?: HyperScoreboard;
  private platformTexture?: Texture;
  private platformTextureSlime?: Texture;
  private platformTextureVolcano?: Texture;
  private platformTextureStorm?: Texture;
  private platformSprites: Sprite[] = [];
  private platforms: Platform[] = [];
  private ripples: Ripple[] = [];
  private width = 0;
  private height = 0;
  private cameraY = 0;
  private highestY = 0;
  private grappleCooldown = 0;
  private grapple: ActiveGrapple | null = null;
  private score = 0;
  /** Highest stair id that has already awarded points (landing or grapple). */
  private lastScoredStairId = -1;
  /** Next id assigned to a stair recycled to the top. */
  private nextStairId = 0;

  /** Successful chains within `COMBO.chainWindowSec`; 0 = idle. */
  private comboChain = 0;
  private lastChainTime = -1e9;
  private runTime = 0;
  private comboPopups: ComboPopup[] = [];
  private beastParticles: BeastParticle[] = [];
  private beastParticleSpawnAcc = 0;
  private shakeTime = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;

  async init(app: Application): Promise<void> {
    this.app = app;
    this.width = app.screen.width;
    this.height = app.screen.height;

    await Promise.all([this.loadPlatformSprite(), this.player.load()]);

    app.stage.addChild(this.gameShake);
    this.gameShake.addChild(this.background);
    this.gameShake.addChild(this.world);
    this.world.addChild(
      this.jelly,
      this.platformSpriteLayer,
      this.platformLayer,
      this.rippleLayer,
      this.tongueLayer,
      this.fxLayer,
      this.player,
    );

    this.scoreboard = new HyperScoreboard();
    this.scoreboard.position.set(10, 6);
    this.scoreboard.onResize(this.width);
    app.stage.addChild(this.scoreboard);

    this.input = new InputManager(app);
    this.input.attach();

    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();
  }

  update(ticker: Ticker): void {
    const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);
    this.runTime += dt;
    this.expireComboIfNeeded();
    this.grappleCooldown = Math.max(0, this.grappleCooldown - dt);

    if (this.grapple?.phase === 'extend') {
      this.grapple.extendT += dt;
      if (this.grapple.extendT >= GRAPPLE.extendSec) {
        this.grapple.phase = 'pull';
      }
    }

    if (this.grapple?.phase === 'pull') {
      const mouth = this.getMouthWorld();
      const body = this.player.body;
      const dx = this.grapple.targetX - mouth.x;
      const dy = this.grapple.targetY - mouth.y;
      const dist = Math.hypot(dx, dy);
      const len = dist > 1e-3 ? dist : 1;
      const ux = dx / len;
      const uy = dy / len;
      const towardSpeed = body.vx * ux + body.vy * uy;

      const closeDetach = dist < GRAPPLE.detachDistancePx;
      const peakDetach =
        towardSpeed <= GRAPPLE.peakReleaseTowardSpeed &&
        dist >= GRAPPLE.peakReleaseMinDist &&
        dist <= GRAPPLE.peakReleaseMaxDist;

      if (closeDetach || peakDetach) {
        const peakBonus = peakDetach && !closeDetach;
        const vyMul = peakBonus ? GRAPPLE.peakLaunchVyMul : 1;
        const vxMul = peakBonus ? GRAPPLE.peakLaunchVxMul : 1;

        if (towardSpeed > 0 && uy < 0) {
          body.vy -= towardSpeed * GRAPPLE.slingshotUpwardBoost * -uy;
        }

        body.vy += GRAPPLE.launchVy * vyMul;
        const sx = Math.sign(dx) === 0 ? this.player.direction : Math.sign(dx);
        body.vx += sx * GRAPPLE.launchVxBoost * vxMul;
        if (peakBonus) {
          body.vx += body.vx * 0.08;
          body.vy += body.vy * 0.06;
        }

        body.grounded = false;
        this.player.onGrappleLaunch();
        const hookId = this.grapple.hookStairId;
        const grappleGain = Math.max(0, hookId - this.lastScoredStairId);
        if (grappleGain > 0) {
          const launchSpeed = Math.hypot(body.vx, Math.abs(body.vy));
          this.feedComboFromGrapple(grappleGain, peakBonus, launchSpeed);
          const mult = this.getComboMultiplier();
          const delta = grappleGain * mult;
          this.score += delta;
          this.lastScoredStairId = hookId;
          this.maybeSpawnComboPopup(mult);
          this.scoreboard?.onPointsGained(delta);
          this.maybeTriggerScreenShake(delta, mult);
        }
        this.grapple = null;
        this.grappleCooldown = GRAPPLE.cooldownSec;
      }
    }

    const axis = this.input?.getHorizontalAxis() ?? 0;
    const pulling = this.grapple?.phase === 'pull';
    const axisScale = pulling ? GRAPPLE.horizontalInputScaleWhilePulling : 1;

    this.physics.applyHorizontalInput(this.player.body, axis * axisScale, dt);
    this.handleActions();

    const gravityScale = pulling ? GRAPPLE.gravityMultiplierWhilePulling : 1;
    if (pulling && this.grapple) {
      const mouth = this.getMouthWorld();
      this.physics.applyGrappleAcceleration(
        this.player.body,
        this.grapple.targetX,
        this.grapple.targetY,
        mouth.x,
        mouth.y,
        dt,
      );
    }

    const result = this.physics.update(
      this.player.body,
      this.platforms,
      this.width,
      dt,
      gravityScale,
    );
    if (result.landedPlatform) {
      this.player.onLand(result.impactVy);
      const p = result.landedPlatform;
      const landGain = Math.max(0, p.stairId - this.lastScoredStairId);
      if (landGain > 0) {
        this.feedComboFromLand();
        const mult = this.getComboMultiplier();
        const delta = landGain * mult;
        this.score += delta;
        this.lastScoredStairId = p.stairId;
        this.maybeSpawnComboPopup(mult);
        this.scoreboard?.onPointsGained(delta);
        this.maybeTriggerScreenShake(delta, mult);
      }
      this.landOn(p);
    }

    this.updateCamera(dt);
    this.recycleStairsOffscreen();
    this.syncPlatformSpritesFromPlatforms();
    this.checkFallGameOver();
    this.updateRipples(dt);
    this.updateBeastParticles(dt);
    this.updateComboPopups(dt);
    const mult = this.getComboMultiplier();
    this.player.update(
      dt,
      axis,
      this.highestY < -650,
      this.grapple,
      mult >= COMBO.beastModeMinMultiplier,
    );
    this.drawDynamicWorld();
    this.updateScreenShake(dt);
    const heightMeters = Math.max(0, Math.floor(-this.highestY / 12));
    this.scoreboard?.update(dt, this.score, mult, heightMeters, this.runTime);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.resetRun();
    this.drawStaticWorld();
    this.drawDynamicWorld();

    if (this.scoreboard) {
      this.scoreboard.onResize(width);
      this.scoreboard.position.set(10, 6);
    }
  }

  destroy(): void {
    this.input?.destroy();
    this.clearPlatformSprites();
    this.clearFloatingComboUi();
    this.scoreboard?.destroy();
    this.gameShake.destroy({ children: true });
  }

  private handleActions(): void {
    const wantGrapple = this.input?.consumeGrapple() ?? false;
    if (wantGrapple && this.grappleCooldown <= 0 && !this.grapple) {
      const mouth = this.getMouthWorld();
      const hit = Physics.castGrappleTarget(this.platforms, mouth.x, mouth.y);
      if (hit) {
        this.grapple = {
          phase: 'extend',
          targetX: hit.x,
          targetY: hit.y,
          extendT: 0,
          hookStairId: hit.platform.stairId,
        };
      }
    }

    const jumpPressed = this.input?.consumeJump() ?? false;

    if (jumpPressed && this.player.body.grounded && !this.grapple) {
      this.physics.jump(this.player.body);
      this.player.onJump();
    }
  }

  private createPlatforms(): void {
    this.platforms = [];
    this.clearPlatformSprites();
    const baseY = this.height - 96;

    for (let index = 0; index < STAIRS.poolCount; index += 1) {
      const width = 150 + ((index * 37) % 80);
      const x = 48 + ((index * 113) % Math.max(160, this.width - width - 96));
      const y = baseY - index * STAIRS.stepPx;
      this.platforms.push({
        x,
        y,
        width,
        height: STAIRS.platformHeight,
        stairId: index,
      });
    }

    this.nextStairId = STAIRS.poolCount - 1;
    this.createPlatformSprites();
  }

  /**
   * Steps that scroll below visible area move to the top with a new stairId so climbing is endless.
   */
  private recycleStairsOffscreen(): void {
    const cutoff = this.cameraY + this.height + STAIRS.recycleBelowScreenPx;
    const staying = this.platforms.filter((p) => p.y <= cutoff);
    if (staying.length === 0 || staying.length === this.platforms.length) {
      return;
    }

    const toRecycle = this.platforms.filter((p) => p.y > cutoff).sort((a, b) => b.y - a.y);
    let spawnY = Math.min(...staying.map((p) => p.y)) - STAIRS.stepPx;

    for (const p of toRecycle) {
      this.nextStairId += 1;
      p.stairId = this.nextStairId;
      p.y = spawnY;
      p.width = 150 + ((this.nextStairId * 37) % 80);
      p.x = 48 + ((this.nextStairId * 113) % Math.max(160, this.width - p.width - 96));
      spawnY -= STAIRS.stepPx;
    }
  }

  private syncPlatformSpritesFromPlatforms(): void {
    if (!this.platformTexture) {
      return;
    }

    const climbM = Math.max(0, Math.floor(-this.highestY / 12));

    let tex: Texture = this.platformTexture;
    let artMul = 1;

    if (climbM >= STAIRS.stormPlatformAfterMeters && this.platformTextureStorm !== undefined) {
      tex = this.platformTextureStorm;
      artMul = STAIRS.stormPlatformArtScale;
    } else if (climbM >= STAIRS.volcanoPlatformAfterMeters && this.platformTextureVolcano !== undefined) {
      tex = this.platformTextureVolcano;
      artMul = STAIRS.volcanoPlatformArtScale;
    } else if (climbM >= STAIRS.slimePlatformAfterMeters && this.platformTextureSlime !== undefined) {
      tex = this.platformTextureSlime;
      artMul = STAIRS.slimePlatformArtScale;
    } else if (climbM >= STAIRS.compactPlatformArtAfterMeters) {
      artMul = STAIRS.compactPlatformArtScale;
    }

    for (let i = 0; i < this.platforms.length; i += 1) {
      const platform = this.platforms[i];
      const sprite = this.platformSprites[i];
      if (!sprite) {
        continue;
      }

      if (sprite.texture !== tex) {
        sprite.texture = tex;
      }

      sprite.width = platform.width * artMul;
      sprite.scale.y = Math.abs(sprite.scale.x);
      sprite.position.set(platform.x + platform.width / 2, platform.y + platform.height / 2 + 6);
    }
  }

  private resetRun(): void {
    this.clearFloatingComboUi();
    this.score = 0;
    this.lastScoredStairId = -1;
    this.cameraY = 0;
    this.highestY = 0;
    this.comboChain = 0;
    this.lastChainTime = -1e9;
    this.beastParticles = [];
    this.beastParticleSpawnAcc = 0;
    this.shakeTime = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.createPlatforms();
    this.resetPlayer();
    this.scoreboard?.reset();
  }

  private checkFallGameOver(): void {
    const feetY = this.player.body.y + this.player.body.height;
    const deathLine = this.cameraY + this.height + STAIRS.fallDeathBelowViewportPx;
    if (feetY > deathLine) {
      this.resetRun();
    }
  }

  private resetPlayer(): void {
    const start = this.platforms[0];
    this.player.body.x = Math.round(start.x + start.width / 2 - this.player.body.width / 2);
    this.player.body.y = Math.round(start.y - this.player.body.height);
    this.player.body.vx = 0;
    this.player.body.vy = 0;
    this.player.body.grounded = true;
    this.grapple = null;
    this.grappleCooldown = 0;
    this.lastScoredStairId = start.stairId;
    this.player.update(0, 0, false, null, false);
  }

  private landOn(platform: Platform): void {
    this.ripples.push({
      x: this.player.body.x + this.player.body.width / 2,
      y: platform.y + 46,
      age: 0,
    });
  }

  private updateCamera(dt: number): void {
    this.highestY = Math.min(this.highestY, this.player.body.y);
    const targetY = Math.min(0, this.player.body.y - this.height * 0.45);
    this.cameraY += (targetY - this.cameraY) * Math.min(1, dt * 5);
    this.world.position.y = -this.cameraY;
  }

  private updateScreenShake(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / SCORE_UI.shakeDurationSec);
      const mag = SCORE_UI.shakeMaxPx * k;
      this.shakeOffsetX = (Math.random() - 0.5) * 2 * mag;
      this.shakeOffsetY = (Math.random() - 0.5) * 2 * mag;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    this.gameShake.position.set(this.shakeOffsetX, this.shakeOffsetY);
  }

  private maybeTriggerScreenShake(pointsDelta: number, mult: number): void {
    if (
      pointsDelta >= SCORE_UI.bigPointsThreshold ||
      (pointsDelta >= SCORE_UI.shakePointsFloor && mult >= SCORE_UI.shakeMinMultForFloor)
    ) {
      this.shakeTime = Math.max(this.shakeTime, SCORE_UI.shakeDurationSec);
    }
  }

  private updateRipples(dt: number): void {
    this.ripples = this.ripples
      .map((ripple) => ({ ...ripple, age: ripple.age + dt }))
      .filter((ripple) => ripple.age < 0.8);
  }

  private expireComboIfNeeded(): void {
    if (
      this.comboChain > 0 &&
      this.runTime - this.lastChainTime > COMBO.chainWindowSec
    ) {
      this.comboChain = 0;
    }
  }

  private getComboMultiplier(): number {
    if (this.comboChain <= 0) {
      return 1;
    }

    return Math.min(COMBO.maxMultiplier, this.comboChain);
  }

  private feedComboFromLand(): void {
    this.comboChain += 1;
    this.lastChainTime = this.runTime;
  }

  private feedComboFromGrapple(
    grappleGain: number,
    peakBonus: boolean,
    launchSpeed: number,
  ): void {
    let add = 1 + Math.max(0, grappleGain - 1);
    if (peakBonus && launchSpeed >= COMBO.highLaunchSpeedPx) {
      add += 1;
    }

    this.comboChain += add;
    this.lastChainTime = this.runTime;
  }

  private maybeSpawnComboPopup(mult: number): void {
    if (mult < 2) {
      return;
    }

    if (mult === SCORE_UI.apexComboMultiplier) {
      this.scoreboard?.triggerApexBurst();
    }

    if (mult >= COMBO.beastModeMinMultiplier) {
      this.scoreboard?.triggerBeastBurst();
    }

    const wordIndex = Math.min(
      COMBO.words.length - 1,
      Math.max(0, mult - 2),
    );
    this.spawnComboPopup(COMBO.words[wordIndex]);
  }

  private spawnComboPopup(text: string): void {
    const wx = this.player.body.x + this.player.body.width * 0.5;
    const wy = this.player.body.y + this.player.body.height * 0.4;
    const label = new Text({
      text,
      style: {
        fill: '#fff5e6',
        fontFamily: 'Arial Black, Impact, sans-serif',
        fontSize: 28,
        stroke: { color: '#4a1530', width: 5 },
        dropShadow: {
          alpha: 0.55,
          angle: Math.PI / 4,
          blur: 4,
          color: '#ff2288',
          distance: 3,
        },
      },
    });
    label.anchor.set(0.5);
    label.position.set(wx, wy);
    label.scale.set(0.35);
    label.alpha = 1;
    this.world.addChild(label);
    this.comboPopups.push({ label, t: 0, wx, wy });
  }

  private updateComboPopups(dt: number): void {
    const life = COMBO.floatLifeSec;
    const next: ComboPopup[] = [];

    for (const p of this.comboPopups) {
      p.t += dt;
      const u = p.t / life;
      if (u >= 1) {
        p.label.destroy();
        continue;
      }

      const popT = Math.min(1, p.t / COMBO.popInSec);
      const popScale = 0.4 + 0.8 * Math.sin((popT * Math.PI) / 2);
      const drift = COMBO.floatDriftPxPerSec * p.t;
      p.label.position.set(p.wx, p.wy - drift);
      p.label.alpha = 1 - u * u;
      p.label.scale.set(popScale * (1 - 0.12 * u));

      next.push(p);
    }

    this.comboPopups = next;
  }

  private updateBeastParticles(dt: number): void {
    const beast = this.getComboMultiplier() >= COMBO.beastModeMinMultiplier;
    const spd = Math.hypot(this.player.body.vx, this.player.body.vy);

    if (beast && spd >= COMBO.beastParticleMinSpeed) {
      this.beastParticleSpawnAcc += dt;
      while (this.beastParticleSpawnAcc >= COMBO.beastParticleSpawnIntervalSec) {
        this.beastParticleSpawnAcc -= COMBO.beastParticleSpawnIntervalSec;
        const px =
          this.player.body.x +
          this.player.body.width * 0.5 +
          (Math.random() - 0.5) * 36;
        const py =
          this.player.body.y +
          this.player.body.height * 0.5 +
          (Math.random() - 0.5) * 28;
        this.beastParticles.push({ x: px, y: py, age: 0 });
      }
    } else {
      this.beastParticleSpawnAcc = 0;
    }

    this.beastParticles = this.beastParticles
      .map((p) => ({ ...p, age: p.age + dt }))
      .filter((p) => p.age < COMBO.beastParticleLifeSec);

    if (this.beastParticles.length > 40) {
      this.beastParticles.splice(0, this.beastParticles.length - 40);
    }
  }

  private clearFloatingComboUi(): void {
    for (const p of this.comboPopups) {
      p.label.destroy();
    }

    this.comboPopups = [];
  }

  private drawStaticWorld(): void {
    this.background.clear();
    this.background.rect(0, 0, this.width, this.height).fill({ color: 0x000000 });
  }

  private drawDynamicWorld(): void {
    this.jelly.clear();
    this.platformLayer.clear();
    this.rippleLayer.clear();
    this.tongueLayer.clear();
    this.fxLayer.clear();

    for (const ripple of this.ripples) {
      const radius = 28 + ripple.age * 130;
      const alpha = 1 - ripple.age / 0.8;
      this.rippleLayer
        .ellipse(ripple.x, ripple.y, radius, radius * 0.28)
        .stroke({ color: 0x8b5cff, alpha: alpha * 0.12, width: 1 });
    }

    for (const platform of this.platforms) {
      this.drawCrystalPlatform(platform);
    }

    const grappleProgress = Player.computeGrappleAnimProgress(this.grapple, GRAPPLE.extendSec);
    const drawProceduralTongue =
      !!this.grapple &&
      (this.grapple.phase === 'pull' || grappleProgress < GRAPPLE.proceduralTongueUntil);
    if (drawProceduralTongue) {
      const mouth = this.getMouthWorld();
      const tip = this.getTongueTipWorld(mouth);
      this.drawGrappleTongue(mouth, tip, this.getComboMultiplier() >= COMBO.beastModeMinMultiplier);
    }

    for (const p of this.beastParticles) {
      const u = p.age / COMBO.beastParticleLifeSec;
      const alpha = (1 - u) * 0.5;
      const r = 6 + 10 * (1 - u);
      this.fxLayer.circle(p.x, p.y, r).fill({ color: 0xff9933, alpha });
      this.fxLayer.circle(p.x - 2, p.y - 2, r * 0.45).fill({ color: 0xffeeaa, alpha: alpha * 0.9 });
    }
  }

  private getMouthWorld(): { x: number; y: number } {
    const b = this.player.body;
    const cx = b.x + b.width * 0.5;
    const cy = b.y + b.height * 0.5;
    return {
      x: cx + this.player.direction * GRAPPLE.mouthOffsetX,
      y: cy + GRAPPLE.mouthOffsetY,
    };
  }

  private getTongueTipWorld(mouth: { x: number; y: number }): { x: number; y: number } {
    if (!this.grapple) {
      return mouth;
    }

    if (this.grapple.phase === 'extend') {
      const t = Math.min(1, this.grapple.extendT / GRAPPLE.extendSec);
      return {
        x: mouth.x + (this.grapple.targetX - mouth.x) * t,
        y: mouth.y + (this.grapple.targetY - mouth.y) * t,
      };
    }

    return { x: this.grapple.targetX, y: this.grapple.targetY };
  }

  private drawGrappleTongue(
    mouth: { x: number; y: number },
    tip: { x: number; y: number },
    beastMode: boolean,
  ): void {
    const outlineColor = beastMode ? COMBO.beastTongueOutline : GRAPPLE.tongueOutline;
    const fillColor = beastMode ? COMBO.beastTongueFill : GRAPPLE.tongueColor;
    const outlineW = beastMode ? GRAPPLE.tongueOutlineWidth + 3 : GRAPPLE.tongueOutlineWidth;
    const coreW = beastMode ? GRAPPLE.tongueWidth + 2 : GRAPPLE.tongueWidth;
    const dx = tip.x - mouth.x;
    const dy = tip.y - mouth.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) {
      return;
    }

    const nx = (-dy / len) * 16;
    const ny = (dx / len) * 16;
    const mx = (mouth.x + tip.x) * 0.5 + nx;
    const my = (mouth.y + tip.y) * 0.5 + ny;

    this.tongueLayer
      .moveTo(mouth.x, mouth.y)
      .lineTo(mx, my)
      .lineTo(tip.x, tip.y)
      .stroke({
        width: outlineW,
        color: outlineColor,
        cap: 'round',
        join: 'round',
        alpha: 0.88,
      });
    this.tongueLayer
      .moveTo(mouth.x, mouth.y)
      .lineTo(mx, my)
      .lineTo(tip.x, tip.y)
      .stroke({
        width: coreW,
        color: fillColor,
        cap: 'round',
        join: 'round',
        alpha: 0.96,
      });
  }

  private drawCrystalPlatform(platform: Platform): void {
    if (!this.platformTexture) {
      this.platformLayer
        .roundRect(platform.x, platform.y, platform.width, platform.height, 6)
        .fill({ color: 0x8c7ac2, alpha: 0.55 });
    }
  }

  private async loadPlatformSprite(): Promise<void> {
    this.platformTexture = await this.createCheckerTransparentTexture(crystalPlatformUrl);
    try {
      this.platformTextureSlime = await this.createEdgeDarkTransparentTexture(slimePlatformUrl);
    } catch {
      this.platformTextureSlime = undefined;
    }
    try {
      this.platformTextureVolcano = await this.createEdgeDarkTransparentTexture(volcanoPlatformUrl);
    } catch {
      this.platformTextureVolcano = undefined;
    }
    try {
      this.platformTextureStorm = await this.createEdgeDarkTransparentTexture(stormPlatformUrl);
    } catch {
      this.platformTextureStorm = undefined;
    }
  }

  private createPlatformSprites(): void {
    if (!this.platformTexture) {
      return;
    }

    for (const platform of this.platforms) {
      const sprite = new Sprite(this.platformTexture);
      sprite.anchor.set(0.5);
      sprite.width = platform.width;
      sprite.scale.y = Math.abs(sprite.scale.x);
      sprite.position.set(platform.x + platform.width / 2, platform.y + platform.height / 2 + 6);
      sprite.alpha = 0.98;
      this.platformSpriteLayer.addChild(sprite);
      this.platformSprites.push(sprite);
    }
  }

  private clearPlatformSprites(): void {
    for (const sprite of this.platformSprites) {
      sprite.destroy();
    }

    this.platformSprites = [];
    this.platformSpriteLayer.removeChildren();
  }

  private async createCheckerTransparentTexture(url: string): Promise<Texture> {
    const sourceTexture = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return sourceTexture;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedCheckerBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  /** Removes solid black / near-black regions connected to image edges (exported UI art). */
  private async createEdgeDarkTransparentTexture(url: string): Promise<Texture> {
    const fallback = await Assets.load<Texture>(url);
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return fallback;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    this.removeConnectedDarkEdgeBackground(imageData.data, canvas.width, canvas.height);
    context.putImageData(imageData, 0, 0);

    return Texture.from(canvas);
  }

  private removeConnectedDarkEdgeBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isDarkEdgeBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private removeConnectedCheckerBackground(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): void {
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];

    const enqueue = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) {
        return;
      }

      visited[pixelIndex] = 1;

      if (this.isCheckerBackgroundPixel(pixels, pixelIndex)) {
        queue.push(pixelIndex);
      }
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0);
      enqueue(x, height - 1);
    }

    for (let y = 0; y < height; y += 1) {
      enqueue(0, y);
      enqueue(width - 1, y);
    }

    while (queue.length > 0) {
      const pixelIndex = queue.pop() ?? 0;
      pixels[pixelIndex * 4 + 3] = 0;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }
  }

  private isDarkEdgeBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    if (alpha < 12) {
      return true;
    }

    return Math.max(red, green, blue) <= DARK_BG_MAX_CHANNEL;
  }

  private isCheckerBackgroundPixel(pixels: Uint8ClampedArray, pixelIndex: number): boolean {
    const dataIndex = pixelIndex * 4;
    const red = pixels[dataIndex];
    const green = pixels[dataIndex + 1];
    const blue = pixels[dataIndex + 2];
    const alpha = pixels[dataIndex + 3];
    const brightness = Math.max(red, green, blue);
    const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);

    return (
      alpha > 0 &&
      brightness > 70 &&
      brightness < 220 &&
      colorSpread <= CHECKER_BACKGROUND_COLOR_SPREAD
    );
  }
}
