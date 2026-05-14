import './styles/main.css';
import { Game } from './game/Game';
import { runMandatoryLandingGate } from './game/landing/runLandingGate';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Missing #app root element');
}

const game = new Game();

void (async () => {
  await runMandatoryLandingGate(root);
  await game.start(root);
})();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
  });
}
