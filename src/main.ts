import './ui/style.css';
import { Game } from './core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const game = new Game(canvas, ui);
game.start();
