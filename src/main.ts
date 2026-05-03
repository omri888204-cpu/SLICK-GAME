import './styles/main.css';
import { Game } from './game/Game';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Missing #app root element');
}

const game = new Game();

void game.start(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
  });
}
