# slick-game — שיתוף WEB (SLICK)

## חיבור `dist` ל‑Netlify (הכי ישיר)

1. **בנייה מקומית** (בתיקיית הפרויקט):

   ```bash
   npm run build
   ```

2. פתח [app.netlify.com](https://app.netlify.com) והתחבר.

3. **Sites → Add new site → Deploy manually** (לפעמים נקרא "Deploy with drag and drop").

4. **גרור לתוך החלון את כל תיקיית `dist`** (לא את `src` ולא את שורש הפרויקט).  
   הנתיב אצלך: `C:\Users\omri8\Projects\sky-climber\dist`

5. אחרי שהעלאה מסתיימת תקבל כתובת `https://random-name.netlify.app`. אפשר לשנות ל־**slick-game** ב־**Site configuration → Domain management** (אם השם פנוי).

**אם מחובר Git לריפו:** אין צורך לגרור `dist` — Netlify מריץ `npm ci && npm run build` ומפרסם את `dist` לפי `netlify.toml`.

### פריסה מהטרמינל (Netlify CLI)

פעם ראשונה:

```bash
npx netlify-cli login
cd C:\Users\omri8\Projects\sky-climber
npx netlify-cli init
```

אחר כך:

```bash
npm run deploy:netlify
```

(`deploy:netlify:draft` מעלה ל־draft בלי production.)

---

המשחק בנוי כאתר סטטי. אחרי `npm run build` נוצרת תיקיית **`dist/`** — אותה מעלים לאחסון.

## אופציה 1: Netlify (פשוט)

1. [app.netlify.com](https://app.netlify.com) → התחברות.
2. **Add new site → Deploy manually**: גרור את **כל תיקיית `dist`** אחרי בילד מקומי.  
   או חבר ריפו מ-Git — Netlify קורא את `netlify.toml` (בילד: `npm ci && npm run build`, פרסום **`dist`** בלבד).
3. תנו לרשת שם כמו **`slick-game`** → כתובת: `https://slick-game.netlify.app` (אם השם פנוי).

**חשוב:** ב-Netlify → **Site configuration → Build & deploy → Build settings** — אם יש "Publish directory", חייב להיות **`dist`** (או ריק אם רק ה־`netlify.toml` שולט). ערך שגוי כמו `public` או `.` גורם ל־404.

## אם מופיע 404 / "Site not found"

1. **בדיקת deploy:** Netlify → **Deploys** — האם הבילד ירוק? אם אדום, פתחו לוג — לרוב חסר `npm ci` / TypeScript.
2. **כתובת:** השתמשו בדיוק ב־URL שמופיע ב־**Domain settings** (למשל `https://slick-game.netlify.app`), לא בשם ישן.
3. **תוכן `dist` מקומי:** אחרי `npm run build` ודאו שקיימים: `dist/index.html`, `dist/_redirects`, `dist/assets/*` (כולל sprites + `slick-logo`).
4. **SPA:** ב־`dist` חייב להיות `_redirects` עם `/* /index.html 200` ו/או אותו כלל ב־`netlify.toml` (כבר מוגדר).

## לפרוס מחדש (Git-connected)

1. דחיפת הקומיט לברנץ' שמחובר ל-Netlify.
2. או: **Deploys → Trigger deploy → Clear cache and deploy site** אם יש CDN ישן.

## אופציה 2: Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → ייבא ריפו.
2. Framework Preset: **Vite** — או השאר ברירת מחדל; הפלט הסטנדרטי הוא תיקיית **`dist`**.
3. כתובת `https://....vercel.app` מוכנה לשיתוף.

## אופציה 3: Cloudflare Pages

1. **Workers & Pages → Create → Connect to Git** (או העלאת `dist`).
2. Build: `npm run build` · Output: `dist`.
3. קובץ `public/_redirects` מועתק ל-`dist` ומטפל בנתיבים.

## לפני שיתוף (מקומי)

```bash
npm ci
npm run build
npm run preview
```

פתחו את הכתובת שמוצגת (`--host`) ברשת המקומית או העלו את `dist` לאחסון.

## נתיבים יחסיים (Vite `base: './'`)

הבילד מפיק קישורים מסוג `./assets/...` ב־`index.html` — עובד ב-Netlify/Vercel בראש הדומיין, ב־branch previews, וברוב האחסונים הסטטיים.

## הערה על GitHub Pages

אם האתר ב־**Project Page** (`username.github.io/repo/`), `base: './'` בדרך כלל מספיק. אם משהו עדיין נשבר, הגדירו `base: '/repo/'` ב־`vite.config.ts` כמתואר בתיעוד Vite.
