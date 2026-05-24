import {
  computeMenuCoverLayout,
  computeMenuLootTextScreenPoints,
  MENU_CANDY_LOOP_TEX_H,
  MENU_CANDY_LOOP_TEX_W,
} from '../constants/menuBackground';

/** HTML overlay — gold / diamond totals on the menu brown pills (always above canvas). */
export class MenuLootTotalsOverlay {
  private readonly root: HTMLDivElement;
  private readonly goldEl: HTMLSpanElement;
  private readonly diamondEl: HTMLSpanElement;
  private mounted = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'menu-loot-totals';
    this.root.setAttribute('aria-hidden', 'true');

    this.goldEl = document.createElement('span');
    this.goldEl.className = 'menu-loot-totals__gold';
    this.goldEl.textContent = '';

    this.diamondEl = document.createElement('span');
    this.diamondEl.className = 'menu-loot-totals__diamond';
    this.diamondEl.textContent = '';

    this.root.style.visibility = 'hidden';

    this.root.append(this.goldEl, this.diamondEl);
  }

  mount(host: HTMLElement): void {
    if (this.mounted) {
      return;
    }
    host.appendChild(this.root);
    this.mounted = true;
  }

  unmount(): void {
    this.root.remove();
    this.mounted = false;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  setTotals(gold: number, diamonds: number): void {
    this.root.style.visibility = 'visible';
    this.goldEl.textContent = Math.max(0, Math.floor(gold)).toLocaleString();
    this.diamondEl.textContent = Math.max(0, Math.floor(diamonds)).toLocaleString();
  }

  layout(canvas: HTMLCanvasElement, logicalW: number, logicalH: number): void {
    const marginLeft = Number.parseFloat(canvas.style.marginLeft) || 0;
    const marginTop = Number.parseFloat(canvas.style.marginTop) || 0;
    const displayW = Number.parseFloat(canvas.style.width) || logicalW;
    const displayH = Number.parseFloat(canvas.style.height) || logicalH;
    const scaleX = displayW / Math.max(1, logicalW);
    const scaleY = displayH / Math.max(1, logicalH);

    const cover = computeMenuCoverLayout(
      logicalW,
      logicalH,
      MENU_CANDY_LOOP_TEX_W,
      MENU_CANDY_LOOP_TEX_H,
    );
    const points = computeMenuLootTextScreenPoints(cover);
    const uiScale = Math.min(scaleX, scaleY);
    const fontPx = Math.max(10, Math.min(16, Math.round(13.5 * cover.scale * uiScale)));

    const goldX = marginLeft + points.gold.x * scaleX;
    const goldY = marginTop + points.gold.y * scaleY;
    const diamondX = marginLeft + points.diamond.x * scaleX;
    const diamondY = marginTop + points.diamond.y * scaleY;

    this.goldEl.style.left = `${goldX}px`;
    this.goldEl.style.top = `${goldY}px`;
    this.goldEl.style.fontSize = `${fontPx}px`;

    this.diamondEl.style.left = `${diamondX}px`;
    this.diamondEl.style.top = `${diamondY}px`;
    this.diamondEl.style.fontSize = `${fontPx}px`;
  }
}
