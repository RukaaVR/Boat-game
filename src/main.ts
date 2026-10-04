// Bundled (offline-safe) anime UI fonts: Bangers for display, M PLUS Rounded for text.
import '@fontsource/bangers/latin-400.css';
import '@fontsource/m-plus-rounded-1c/latin-700.css';
import '@fontsource/m-plus-rounded-1c/latin-800.css';
import '@fontsource/m-plus-rounded-1c/latin-900.css';
import './ui/style.css';
import { Game } from './core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const game = new Game(canvas, ui);
game.start();

// Offline support (production builds only; never under the test harness).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !location.search.includes('harness')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Offline mode is a bonus: the game runs fine without it. */
    });
  });
}
