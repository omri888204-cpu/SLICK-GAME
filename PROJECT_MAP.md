# PROJECT MAP — Slick

## 1. סקירה כללית

- **שם המשחק:** SLICK (`package.json`: `slick-game`, כותרת ב־`index.html`: "SLICK — slick-game").
- **סגנון:** פלטפורמר אנכי בסגנון Icy Tower — טיפוס אינסופי במגדל/מגדלים, קפיצות רצופות, Combo chain, מסך שממשיך לעלות עם השחקן.
- **פלטפורמת יעד:** **Web / mobile web** (viewport מלא, בקרות מגע, `touch-action: none`). יש תמיכה אופציונלית ב־**Capacitor** ל־Android/iOS (`capacitor.config.json`, סקריפטים `android:*` / `ios:*` ב־`package.json`) — לא נמצא בניית native פעילה בתיקיית הפרויקט (תיקיות `android/` / `ios/` ב־`.gitignore`).

**סטאק טכנולוגי**

| רכיב | פירוט |
|------|--------|
| שפה | TypeScript |
| מנוע רינדור | **PixiJS v8** (`pixi.js`) |
| ספריות נלוות | `pixi-filters` (Glow), `pixi-dragonbones-runtime` (לשון — אם קיימים נכסי DB), `gsap` (ב־`package.json`; לא נמצא שימוש ישיר ב־`src/`), `firebase` (Auth + RTDB), `@capacitor/core` |
| Build | **Vite 6** (`vite build`, `base: './'`) |
| אירוח | **Netlify** ראשי — [https://slick-game.netlify.app](https://slick-game.netlify.app) (`netlify.toml`, `WEB.md`). קיים גם `vercel.json` (SPA rewrite ל־`index.html`) — פריסה כפולה אפשרית, לא מתועד איזה סביבה production בפועל מעבר ל־Netlify ב־`WEB.md`. |

**נקודת כניסה**

1. `index.html` — `<div id="app">` + `<script type="module" src="/src/main.ts">`
2. `src/main.ts` — `runMandatoryLandingGate` (Firebase / onboarding) → `new Game().start(root)`
3. `src/game/Game.ts` — יוצר `Application` (Pixi), ticker, מעבר סצנות: `BootScene` → `MenuScene` → `PlayScene`

---

## 2. מבנה תיקיות

```
sky-climber/
├── index.html              # דף יחיד — SPA
├── package.json            # תלויות, סקריפטי build/deploy
├── vite.config.ts          # Vite, base יחסי ל-dist
├── netlify.toml            # build → dist, SPA redirects
├── vercel.json             # SPA rewrite (אופציונלי)
├── capacitor.config.json   # webDir: dist — לאפליקציה native
├── public/                 # נכסים סטטיים — מוגשים כ-/assets/ אחרי build
│   ├── _redirects
│   └── assets/             # רוב הארט, מוזיקה, SFX, UI ציבורי
├── src/
│   ├── main.ts             # כניסת אפליקציה
│   ├── firebase.js         # אתחול Firebase
│   ├── config/
│   │   └── game.config.ts  # קבועי פיזיקה, מדרגות, Combo, איסוף, UI
│   ├── styles/
│   │   └── main.css        # #app fullscreen, landing gate
│   ├── assets/             # נכסים ש-Vite מייבא (hash ב-build)
│   │   ├── sprites/        # פלטפורמות (crystal/slime/volcano), chameleon_hero
│   │   └── ui/             # slick-logo.png (boot/menu/landing)
│   └── game/
│       ├── Game.ts         # Application + scene manager + game loop
│       ├── scenes/         # Boot, Menu, Play (+ Scene.ts ממשק)
│       ├── entities/       # Player.ts
│       ├── systems/        # Physics.ts, InputManager.ts
│       ├── ui/             # HyperScoreboard, ComboBadge, VirtualJoystick, CSS תפריט
│       ├── audio/          # ComboSynth.ts
│       ├── services/       # leaderboard, userSession, playerProfile, rtdbUsers
│       ├── landing/        # runLandingGate.ts — auth לפני משחק
│       ├── constants/      # playerSkin.ts
│       └── utils/          # logoTexture, quickStartDevice
├── scripts/                # כלי עזר (למשל clean-loot-sheet.mjs)
├── tools/                  # סקריפט Python לניקוי ארט
└── prompts/                # הנחיות פנימיות (למשל blink-eyes.md)
```

**הסבר תיקיות משמעותיות**

| תיקייה | תפקיד |
|--------|--------|
| `public/assets/` | נכסי ריצה דרך `import.meta.env.BASE_URL + 'assets/...'` — רקעים, מפלצות, Player staff, SFX, UI joystick |
| `src/assets/` | ייבוא Vite (`import url from '...'`) — לוגו, ספרייטי פלטפורמה עיקריים |
| `src/game/scenes/PlayScene.ts` | ~10k שורות — רוב לוגיקת המשחק, רינדור עולם, HUD, איסוף |
| `src/config/game.config.ts` | ערכי גלובליים (לא צבעי UI מלאים — חלקם ב־PlayScene) |

תיקיות ריקות / ללא קבצים ב-repo (נמצאו בתור תיקיות בלבד): `src/assets/bg/`, `src/assets/dragonbones/`, `src/assets/spine/` — **אין קבצים**.

---

## 3. נכסים גרפיים (Assets)

נתיב בסיס בזמן ריצה: `` `${import.meta.env.BASE_URL}assets` `` (קבוע `GAME_ASSETS` ב־`PlayScene.ts`).

### פלטפורמות (platforms)

| שלב (HUD מ׳) | מיקום פיזי | טעינה בקוד | קונבנציית שמות |
|---------------|------------|------------|----------------|
| 0–1000 מ׳ | **אין PNG** — גשר חרוזים וקורד (procedural) | `syncBeadBridgePlatformSprite` — `Graphics` ב־`PlayScene.ts` | לוגיקה פנימית: `bead-bridge`, פלטות `BEAD_BRIDGE_PALETTES` |
| 0–1000 מ׳ (גיבוי/שכבה ישנה) | `src/assets/sprites/crystal-platform.png` | `import crystalPlatformUrl` → `loadPlatformSpriteCore` → `createCheckerTransparentTexture` | `crystal-platform.png` |
| מ־1000 מ׳ | `src/assets/sprites/slime-platform.png` | `Assets.load(slimePlatformUrl)` — **ללא** ניקוי קצוות כהים | `slime-platform.png`; אריח פנימי `SLIME_PLATFORM_TILE_PX = 46` |
| מ־2000 מ׳ | `src/assets/sprites/volcano-platform.png` | `createEdgeDarkTransparentTexture(volcanoPlatformUrl)` | `volcano-platform.png` |
| מ־3000 מ׳ | `public/assets/objects/Cloud.png` | נטען כ־`restFloorCloudTexture`, משמש גם כ־**storm** tier לפלטפורמות | `Cloud.png` |
| רצפה כל 1000 מ׳ (`kind: 'rest'`) | procedural ב־`drawRestFloorPlatform` | `platformLayer` Graphics | — |
| Floor 0 (`kind: 'spawn'`) | procedural + רוחב מיוחד | `getFloorZeroSpawnPlatformBounds` | — |

סנכרון ויזואל: `syncPlatformSpritesFromPlatforms` (שורה ~2765), יצירת pool: `createPlatformSprites` (~9606). קבועי סף: `STAIRS` ב־`game.config.ts` (`slimePlatformAfterMeters: 1000`, וכו').

### דמות השחקן וסטייטים

| פריט | מיקום | טעינה | מבנה |
|------|--------|--------|------|
| ספרייטשיט ראשי | `public/assets/Player staff/character_spritesheet.png` | `Player.load()` → `Assets.load` דרך `characterSpritesheetPlayableUrl()` ב־`playerSkin.ts` | 8×7 תאים, **100×40 px** לתא; שורות: idle=0, run=1, jump=2, attack=3 (`Player.ts` שורות 28–37) |
| מצבי משחק | enum `PlayerState` ב־`Player.ts` | אנימציה ב־`pickBodyTexture()` / `update()` | Idle, Walk, Jump, Fall, Grapple, SuperJump, Attack |
| עור playable | `PLAYER_SKIN.NINJA_SLICK` בלבד | `playerSkin.ts` — `normalizeSelectedCharacterSkin` | הרחבה עתידית דרך `Player.updatePlayerSkin` |
| ארט חלופי (לא בשימוש במשחק?) | `src/assets/sprites/chameleon_hero.png` | **לא נמצא** import ב־`src/` | — |

### אובייקטים לאיסוף (מטבעות, כוכבים, יהלומים)

| סוג | מיקום קובץ | טעינה | הערות |
|-----|------------|--------|--------|
| מטבע / יהלום / מגן בעולם | **אין PNG** — ציור ב־`drawCollectibles()` | `collectiblesGfx` (Graphics), עוגנים על פלטפורמות | `COLLECTIBLES` ב־`game.config.ts` |
| כוכבים כאיסוף | **לא נמצא** | — | כוכבים מופיעים רק כ־VFX ב־`HyperScoreboard` (חלקיקי ניקוד) |
| SFX יהלום | `public/assets/sound effect/diamond_collect.mp3` | `PlaySceneSfx` / `SFX_LOCAL` | |
| PNG ב־Player staff | `gold.png`, `DIAMOND.png`, `MUSHROOM.png` | **לא נמצא** שימוש ב־`src/` | כנראה legacy או לאוטציה עתידית |
| תיק (Bag) בסיידבר | אייקונים procedural | `renderBagIcon()` ב־`PlayScene.ts` (~6516) | ספירות מ־Firebase `remoteBagGold` וכו' |

### אלמנטי ממשק (כפתורים, פאנלים, אייקונים)

| רכיב | מיקום | טעינה |
|------|--------|--------|
| פאנל עליון סגול | procedural | `drawTopHeaderPanel()` — `UI_PANEL_PURPURE`, `UI_NEON_GREEN` ב־`PlayScene.ts` |
| ניקוד ראשי | procedural + טקסט | `HyperScoreboard.ts` |
| טיימר / HURRY UP | טקסט + `hurryBannerGfx` | `setupAutoScrollHud()` — באנר HURRY מוסתר בפועל (`refreshAutoScrollHud` מכבה visibility) |
| גובה / מהירות / קפיצות | טקסט ימין עליון | `climbHudText`, `jumpsHudText` — `setupClimbHud` |
| אייקוני זהב/יהלום/מגן ב-HUD | procedural | `drawCollectibleIcons()` |
| כפתורי SUPER JUMP / PULL UP | procedural | `drawHudSkillButton()` — **אין PNG** |
| כפתור התקפה | עיגול + אייקון וקטורי | `setupAttackButton()` (~7102) |
| ג'ויסטיק | `public/assets/ui/joystick-s-cap.png`, `joystick-premium.png` | `VirtualJoystick.ts` — **לא נמצא** שימוש ב־`PlayScene` (מגע = מסך מלא + swipe) |
| תפריט לובי HTML | `MenuScene` — DOM + inline styles; CSS: `mainMenuOverlay.css` מתייחס ל־`main_menu.png` | לוגו: `src/assets/ui/slick-logo.png` |

### רקעים

| שכבה | מיקום | טעינה |
|------|--------|--------|
| Parallax לפי גובה | `public/assets/0-1000M/`, `1K-2KM/`, `2K-3KM/` — `bg_*_layer_*.png` | `BACKGROUND_TIERS`, `loadBackgroundLayerTexture`, `layoutBackground` |
| רקע סטטי / Photoroom | `public/assets/backgroud teset/` (שם עם typo) — `new background.png`, `teset 1-Photoroom.png`, `sky.png`, `sky 3–5.png`, `lava 2.png` | קבועי `STATIC_BG_*`, `BG_TESET_DIR_URL` |
| תיקיית `public/assets/new/` | `bg_1*.png` | **לא נמצא** התייחסות ישירה ב־`BACKGROUND_TIERS` (ייתכן גרסה ישנה) |

### אפקטים ויזואליים

| אפקט | מימוש |
|------|--------|
| Combo badge | `ComboBadge.ts` — Graphics + Text |
| מנצחי עלייה (level up) | חלקיקים + `levelUpFloatText` ב־`PlayScene` |
| ניצוצות קיר (slide phase) | `wallSparkParticleRoot` — טקסטורת `heavy-spark` procedural |
| לשון / grapple | קו procedural או DragonBones — `public/assets/tongue_*.json/png` **לא נמצאו ב-repo**; נפילה ל־`drawGrappleTongue` |
| מפלצות פטריה | `public/assets/monsters/Mushroom-*.png`, `blood.png` |
| מוזיקה / SFX | `public/assets/game music/`, `public/assets/sound effect/` |

---

## 4. לוגיקה מרכזית — איפה מה יושב

| מערכת | קבצים עיקריים | שורות / נקודות עיקריות |
|--------|----------------|-------------------------|
| **לולאת משחק** | `Game.ts` | `app.ticker.add` → `activeScene?.update` (שורה 52). `PlayScene.update` מתחילה **1541** |
| **קפיצה ופיזיקה** | `Physics.ts`, `PlayScene.ts` | קפיצה: `Physics.jump` (**510–513**). לולאת פיזיקה: `Physics.update` (**237–**). קריאה: `PlayScene.update` **1688–1703**. קפיצה מהשחקן: `triggerJumpAction` **2135** |
| **תנועה אופקית** | `Physics.applyHorizontalInput` (**489**), `InputManager.getHorizontalAxis` | ערכי `WALK` ב־`game.config.ts` |
| **יצירת / מחזור פלטפורמות** | `PlayScene.ts` | Pool ראשוני: אתחול מדרגות (~2340–2400). מחזור: `recycleStairsOffscreen` **2406–2448**. עדכון ספרייטים: `syncPlatformSpritesFromPlatforms` **2765** |
| **איסוף וניקוד** | `PlayScene.ts`, `game.config.ts` | ציור: `drawCollectibles` **8852**. לוגיקה: `updateCollectibles` **8838**, `tryPickupCollectible`. ניקוד כולל: `recomputeDerivedTotalScore`, `SCORE_METERS_MULTIPLIER` / `SCORE_COMBO_MULTIPLIER` (~814–815). מונה bag: `goldCount`, `diamondCount` |
| **Combo / Rush** | `PlayScene.ts`, `ComboBadge.ts`, `ComboSynth.ts`, `COMBO` ב־config | רישום קפיצה: `registerComboJump` **2170**. תצוגה: `ComboBadge`, `tickComboHud` **5165**. מילים: `COMBO_TIER_WORDS` ב־`ComboBadge.ts`. Rush בממשק: באנר "HURRY UP" קיים אך **מוסתר** ב־`refreshAutoScrollHud` |
| **HUD** (טיימר, ניקוד, גובה, מהירות) | `HyperScoreboard.ts`, `PlayScene.ts` | ניקוד: `scoreboard.update` בשורה **1865**. טיימר: `timerHudText` / `setupAutoScrollHud` **7728**. גובה+SPD: `refreshClimbHudText` **5022** (`climbHudText`). קפיצות: `jumpsHudText` |
| **כפתורי שליטה** | `PlayScene.ts`, `InputManager.ts` | **Super Jump:** `fireManualSuperJump` (נקרא מ־tap על `superJumpBtnGfx` **5078**). **Pull Up (לשון):** `fireSuperTongue` **5094** — grapple לפלטפורמה מעל. **התקפה:** `InputManager.queueAttack` / מקש F, `playerAttack`, `setupAttackButton` **7102**. מגע: `setupTouchControlsOverlay` **8378** — חצי מסך שמאל/ימין, swipe לקפיצה |

---

## 5. נקודות החלפה לעבודה הוויזואלית הקרובה

### א. פלטפורמות (החלפת ספרייטים)

| טווח גובה | מה לשנות | סוג שינוי | תלויות |
|-----------|----------|-----------|---------|
| **0–1000 מ׳ (חרוזים)** | `PlayScene.ts` — `BEAD_BRIDGE_PALETTES`, `syncBeadBridgePlatformSprite` (~9725) | **קוד בלבד** (צבעים/גיאומטריה) — לא קובץ PNG | רוחב פלטפורמה `platform.width` / `beadBridgeBeadRadius` — גוף התנגדות נשאר AABB ב־`types.Platform` |
| **1000+ crystal** | החלף `src/assets/sprites/crystal-platform.png` | **קובץ** (+ אופציונלי עיבוד שקיפות ב־`createCheckerTransparentTexture`) | גודל אריח משפיע על `syncLegacyPlatformSprite` — `sprite.width = platform.width * artMul`. סף: `STAIRS.compactPlatformArtAfterMeters` / `compactPlatformArtScale` |
| **1000+ slime** | `src/assets/sprites/slime-platform.png` | **קובץ** | חייב להתאים ל־`SLIME_PLATFORM_TILE_PX` (46) לריצוף; קוד מחשב `scaleMul` לפי רוחב מדרגה (~9665–9669) |
| **2000+ volcano** | `src/assets/sprites/volcano-platform.png` | **קובץ** | `createEdgeDarkTransparentTexture` — פיקסלים כהים בקצוות נמחקים; להימנע ממסגרת שחורה דבוקה לקצה |
| **3000+ storm** | `public/assets/objects/Cloud.png` | **קובץ** + אין שינוי נתיב אם השם זהה | `STAIRS.stormPlatformArtScale` (0.72) |
| רצפות 1000 מ׳ | `drawRestFloorPlatform` (~9280) | **קוד** (צבעי `Graphics`) או הרחבה לספרייט | רוחב מלא `platform.width` |

**לאחר החלפת PNG:** הרץ `npm run build`; בדוק גם mobile deferred load (`finishDeferredPlaySceneLoadsForMobile`).

### ב. אובייקטים לאיסוף

| פריט | קבצים | סוג שינוי | תלויות |
|------|--------|-----------|---------|
| מטבע / יהלום / מגן בעולם | `PlayScene.drawCollectibles` (~8852), `COLLECTIBLES` ב־`game.config.ts` | **קוד** (צורות `Graphics`) — אין נתיב PNG לעולם | `coinRadius`, `diamondRadius`, `aboveSurfacePx`, `platformEdgeMarginPx` |
| מעבר לספרייט | יש להוסיף `Sprite` + `Assets.load` ב־`init` ולשנות `drawCollectibles` | קוד + נכס חדש תחת `public/assets/` | מיקום עדיין מעוגן ל־`platformIdx` + `along` |
| SFX איסוף | `public/assets/sound effect/diamond_collect.mp3` | **קובץ** | `SFX_LOCAL.collect_diamond` ב־`PlayScene.ts` |
| אייקוני HUD (מונה) | `drawCollectibleIcons` (~5500) | **קוד** | מיקום: `layoutCollectibleHud` / `syncCollectibleHudPosition` |
| PNG `gold.png` / `DIAMOND.png` | קיימים ב־`public/assets/Player staff/` | **לא מחוברים** — צריך חיווט ב־`renderBagIcon` או HUD אם רוצים ארט מקובץ | — |
| כוכבים | **לא נמצא** כאיסוף | — | — |

### ג. אלמנטי ממשק (HUD עליון, כפתורי פעולה)

| רכיב | קבצים | סוג שינוי | תלויות |
|------|--------|-----------|---------|
| פס עליון סגול | `drawTopHeaderPanel`, קבועי `UI_*` בתחילת `PlayScene.ts` (~712–716) | **קוד** (צבעים/גובה `UI_HEADER_H = 92`) | `layoutHeaderPauseButton`, `layoutSkillPairHud` |
| לוח ניקוד | `HyperScoreboard.ts` | **קוד** | מיקום: `scoreboard.position` ב־`init` (~1500) |
| טיימר / מטר / SPD | `climbHudText`, `timerHudText`, `createNeonGoldTextStyle` | **קוד** | `layoutClimbHud`, `layoutAutoScrollHud` |
| SUPER JUMP / PULL UP | `drawHudSkillButton`, `PULL_UP_BTN_W/H` (~870) | **קוד** — או להחליף ב־`Sprite` מ־PNG ולהוסיף ל־`skillPairRoot` | מיקום: `layoutSkillPairHud` **5114** |
| התקפה | `setupAttackButton`, `drawAttackButtonIcon` (~7102) | **קוד** | עיגול — רדיוס קבוע בקוד |
| מגע | `setupTouchControlsOverlay` | התנהגות, לא ארט מסך (כפתורי JUMP הוסרו מהמסך) | — |

### ד. אייקוני ממשק (כפתורי תפריט)

| רכיב | קבצים | סוג שינוי | תלויות |
|------|--------|-----------|---------|
| Boot / Menu לוגו | `src/assets/ui/slick-logo.png` | **קובץ** (import ב־`BootScene`, `MenuScene`, `runLandingGate`) | `loadLogoTextureTransparent` מסיר רקע כהה |
| תפריט לובי מלא | `public/assets/ui/main_menu.png` | **קובץ** — `mainMenuOverlay.css` מתאר hit regions; **לא נמצא** שימוש ב־`MenuScene.ts` הנוכחי (לובי = DOM פשוט + לוגו Pixi) | אם מחברים: צריך `mount` עם `.mm-root` כמו ב-CSS |
| Pause / Status sidebar | `setupPauseUi`, `setupStatusPanel` ב־`PlayScene.ts` | **קוד** (Graphics + Text) | — |
| Landing auth | `src/styles/main.css` (`.sk-landing`) | **CSS** | לפני `Game.start` |

---

## 6. קונבנציות קיימות

### קונבנציית שמות קבצים

- תיקיות ציבוריות: רווחים מותרים (`Player staff`, `backgroud teset`, `sound effect`) — בקוד: `encodeURIComponent` בנתיבים.
- רקעים לפי טווח גובה: `0-1000M`, `1K-2KM`, `2K-3KM` + `bg_*_layer_N.png`.
- מפלצות: `Mushroom-<State>.png` (Idle, Run, Attack, Die, וכו').
- ספרייטי פלטפורמה ב־`src/assets/sprites/`: `*-platform.png` (kebab-case).
- ייבוא מ־`src/assets/`: נתיב יחסי ב־TypeScript (`import x from '../../assets/...'`).

### צבעים / ערכות

| מקום | תוכן |
|------|--------|
| `game.config.ts` | `EYES` (combo/super), `GRAPPLE.tongueColor` |
| `PlayScene.ts` (קבועים מקומיים) | `UI_BG_BLACK`, `UI_PANEL_PURPLE`, `UI_NEON_GREEN`, `UI_GOLD`, `SPEED_TIER_PULSE_COLOR`, `BEAD_BRIDGE_PALETTES` |
| `ComboBadge.ts` | `COMBO_TIER_COLORS` לפי מילת Combo |
| `main.css` / landing | גרדיאנטים ירוק־סגול כהה |
| `HyperScoreboard` | מילוי HSL דינמי לפי ניקוד/קפיצות |

### גדלים / קבועים גלובליים

- **`src/config/game.config.ts`** — מקור האמת ל: `PHYSICS`, `WALK`, `STAIRS`, `COLLECTIBLES`, `COMBO`, `GRAPPLE`, `RENDER`, `PLAY_SCENE.stairPlatformScale`.
- **`PlayScene.ts`** — עשרות קבועי UI/מצלמה/מדרגות מקומיים (למשל `PLATFORM_SCALE`, `STAIR_GAP_MIN/MAX`, `VIEWPORT_SAFE_MARGIN_SCREEN_PX`).

### טעינת נכסים

| דפוס | שימוש |
|------|--------|
| `import url from '...png'` + `Assets.load` / `createCheckerTransparentTexture` | פלטפורמות, לוגו |
| `` `${GAME_ASSETS}/...` `` + `Assets.load` / `loadTextureFromCandidates` | רוב `public/assets` |
| Preload ב־`PlayScene.init` | `Promise.all` בשורה **1411** — שחקן, SFX, רקע, פלטפורמות |
| Mobile quick start | `loadPlatformSpriteCore` קודם; שאר דקור ב־`finishDeferredPlaySceneLoadsForMobile` |
| `@pixi/sound` | ב־`package.json` — **לא נמצא** שימוש; SFX דרך `HTMLAudioElement` |

---

## 7. אזורים בעייתיים או לא ברורים

1. **`PlayScene.ts` ענק (~10,270 שורות)** — כמעט כל מערכת המשחק במקום אחד; קשה לאתר רגרסיות ויזואליות.
2. **כפילות נכסים:** `public/assets/new/` מול `0-1000M` / `backgroud teset` — לא ברור איזה סט "רשמי".
3. **קבצים שלא בשימוש בקוד (נמצאו על דיסק):** `gold.png`, `DIAMOND.png`, `MUSHROOM.png`, `heart_counter-Sheet.png`, `mana_counter-Sheet.png`, `joystick-premium.png`, `chameleon_hero.png`, `main_menu.png` (CSS בלבד), `VirtualJoystick.ts` (לא מחובר ל־PlayScene).
4. **DragonBones לשון:** קוד מצפה ל־`public/assets/tongue_ske.json`, `tongue_tex.json`, `tongue_tex.png` — **לא נמצאו ב-repo**; עובדים עם לשון וקטורית.
5. **`crystal-platform.png` / `volcano-platform.png`:** קיימים ב־`src/assets/sprites/`; אם חסרים אחרי clone — build ייכשל על ה-import.
6. **`console.log` ב-production loop:** `PlayScene.update` שורה **1864** — `"Current Progress:"` כל פריים פעיל.
7. **שם תיקייה:** `backgroud teset` (שגיאת כתיב) מפוזר בנתיבים — שינוי שם ישבור URLs אלא אם מעדכנים את כל הקבועים.
8. **כוכבים כאיסוף:** לא מיושמים — רק יהלום/מטבע/מגן procedural.
9. **HURRY UP / Rush:** UI קיים אך מוסתר; "RUSH" כמילת Combo ב־`ComboBadge`, לא מנגנון נפרד.
10. **תיקיות ריקות** `src/assets/bg`, `dragonbones`, `spine` — עלולות לבלבל לגבי מקור הארט האמיתי.
11. **אירוח:** תיעוד ראשי Netlify; `vercel.json` קיים — לא ברור אם בשימוש במקביל.

---

## אימות (שלב 3)

מפתח שמחליף **רק** ספרייט פלטפורמת slime ב־1000+ מ׳: להחליף `src/assets/sprites/slime-platform.png` ולבדוק `SLIME_PLATFORM_TILE_PX` אם רוחב האריח השתנה.

מפתח שמחליף מראה פלטפורמות **0–1000 מ׳**: לערוך `syncBeadBridgePlatformSprite` / `BEAD_BRIDGE_PALETTES` — **לא** מספיק להחליף PNG.

מפתח שמחליף מטבע בעולם: `drawCollectibles` + `COLLECTIBLES` — לא תיקיית `public/assets` (אלא אם מוסיפים pipeline ספרייט חדש).
