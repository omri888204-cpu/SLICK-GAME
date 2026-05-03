import type { Application, Ticker } from 'pixi.js';

export interface Scene {
  readonly name: string;
  init(app: Application): void | Promise<void>;
  update(ticker: Ticker): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
