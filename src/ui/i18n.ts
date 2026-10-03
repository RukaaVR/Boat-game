/**
 * Menu translations. `t(key)` looks up the current language and falls back to
 * English, then to the key itself, so a missing string never shows blank.
 * Race HUD callouts stay in English (they are short, iconic and timed to
 * audio stings); everything a player has to read to navigate is translated.
 */

export type Lang = 'en' | 'es' | 'fr' | 'de' | 'pt';
export const LANGS: readonly Lang[] = ['en', 'es', 'fr', 'de', 'pt'];
export const LANG_NAME: Record<Lang, string> = { en: 'ENGLISH', es: 'ESPAÑOL', fr: 'FRANÇAIS', de: 'DEUTSCH', pt: 'PORTUGUÊS' };

type Dict = Record<string, string>;

const en: Dict = {
  play: 'PLAY',
  quick: 'QUICK RACE',
  championship: 'CHAMPIONSHIP',
  timetrial: 'TIME TRIAL',
  stunt: 'STUNT RUN',
  endless: 'ENDLESS WAVE',
  freeride: 'FREE RIDE',
  battle: 'BATTLE',
  career: 'CAREER',
  tutorial: 'TUTORIAL',
  garage: 'GARAGE',
  settings: 'SETTINGS',
  challenges: 'CHALLENGES',
  achievements: 'ACHIEVEMENTS',
  splitscreen: '2 PLAYER',
  replays: 'REPLAY',
  back: 'BACK',
  start: 'START',
  continue: 'CONTINUE',
  resume: 'RESUME',
  restart: 'RESTART',
  quit: 'QUIT TO MENU',
  paused: 'PAUSED',
  photo: 'PHOTO MODE',
  watchReplay: 'WATCH REPLAY',
  raceAgain: 'RACE AGAIN',
  changeCamera: 'CHANGE CAMERA',
  course: 'Course',
  weather: 'Weather',
  laps: 'Laps',
  opponents: 'Opponents',
  watercraft: 'Watercraft',
  trackDefault: 'TRACK DEFAULT',
  level: 'LEVEL',
  credits: 'CREDITS',
  races: 'RACES',
  wins: 'WINS',
  medals: 'MEDALS',
  boats: 'BOATS',
  upgrades: 'UPGRADES',
  paint: 'PAINT',
  stripes: 'STRIPES & DECALS',
  trail: 'TRAIL & BOOST',
  daily: 'DAILY CHALLENGE',
  weekly: 'WEEKLY CHALLENGE',
  completed: 'COMPLETED',
  go: 'GO',
  locked: 'LOCKED',
  language: 'LANGUAGE',
  menuHint: '↑↓ select · ENTER confirm · ESC back',
  quickSub: 'Six boats, three laps, no mercy.',
  champSub: 'A cup of races with points on the line.',
  ttSub: 'Just you, the clock, and your own ghost.',
  freeSub: 'No clock. Explore, jump, chase rings.',
  stuntSub: 'Two minutes. Flips, drifts, rings. Score big.',
  endlessSub: 'The sea keeps rising. Hit checkpoints to survive.',
  battleSub: 'Item boxes, torpedoes, oil and shields. Last one standing wins.',
  careerSub: 'Eight rivals. Beat them one by one.',
  tutorialSub: 'Learn to drift, boost, jump and flip.',
  splitSub: 'Two players, one screen.',
  dynWeather: 'Changing weather',
  on: 'ON',
  off: 'OFF',
  bottles: 'BOTTLES',
};

const es: Dict = {
  play: 'JUGAR', quick: 'CARRERA RÁPIDA', championship: 'CAMPEONATO', timetrial: 'CONTRARRELOJ', stunt: 'ACROBACIAS', endless: 'OLA INFINITA', freeride: 'PASEO LIBRE', battle: 'BATALLA', career: 'CARRERA PRO', tutorial: 'TUTORIAL', garage: 'TALLER', settings: 'AJUSTES', challenges: 'DESAFÍOS', achievements: 'LOGROS', splitscreen: '2 JUGADORES', replays: 'REPETICIÓN', back: 'ATRÁS', start: 'EMPEZAR', continue: 'CONTINUAR', resume: 'REANUDAR', restart: 'REINICIAR', quit: 'SALIR AL MENÚ', paused: 'PAUSA', photo: 'MODO FOTO', watchReplay: 'VER REPETICIÓN', raceAgain: 'OTRA VEZ', changeCamera: 'CAMBIAR CÁMARA', course: 'Circuito', weather: 'Clima', laps: 'Vueltas', opponents: 'Rivales', watercraft: 'Embarcación', trackDefault: 'POR DEFECTO', level: 'NIVEL', credits: 'CRÉDITOS', races: 'CARRERAS', wins: 'VICTORIAS', medals: 'MEDALLAS', boats: 'BARCOS', upgrades: 'MEJORAS', paint: 'PINTURA', stripes: 'FRANJAS Y CALCOS', trail: 'ESTELA Y TURBO', daily: 'DESAFÍO DIARIO', weekly: 'DESAFÍO SEMANAL', completed: 'COMPLETADO', go: 'YA', locked: 'BLOQUEADO', language: 'IDIOMA', menuHint: '↑↓ elegir · ENTER aceptar · ESC atrás', quickSub: 'Seis barcos, tres vueltas, sin piedad.', champSub: 'Una copa de carreras con puntos en juego.', ttSub: 'Tú, el reloj y tu propio fantasma.', freeSub: 'Sin reloj. Explora, salta, persigue aros.', stuntSub: 'Dos minutos. Giros, derrapes, aros.', endlessSub: 'El mar no deja de crecer. Llega a los controles.', battleSub: 'Cajas de objetos, torpedos, aceite y escudos.', careerSub: 'Ocho rivales. Véncelos uno a uno.', tutorialSub: 'Aprende a derrapar, acelerar, saltar y girar.', splitSub: 'Dos jugadores, una pantalla.', dynWeather: 'Clima cambiante', on: 'SÍ', off: 'NO', bottles: 'BOTELLAS',
};

const fr: Dict = {
  play: 'JOUER', quick: 'COURSE RAPIDE', championship: 'CHAMPIONNAT', timetrial: 'CONTRE-LA-MONTRE', stunt: 'CASCADES', endless: 'VAGUE SANS FIN', freeride: 'BALADE LIBRE', battle: 'BATAILLE', career: 'CARRIÈRE', tutorial: 'TUTORIEL', garage: 'GARAGE', settings: 'OPTIONS', challenges: 'DÉFIS', achievements: 'SUCCÈS', splitscreen: '2 JOUEURS', replays: 'RALENTI', back: 'RETOUR', start: 'DÉPART', continue: 'CONTINUER', resume: 'REPRENDRE', restart: 'RECOMMENCER', quit: 'MENU PRINCIPAL', paused: 'PAUSE', photo: 'MODE PHOTO', watchReplay: 'VOIR LE REPLAY', raceAgain: 'REJOUER', changeCamera: 'CHANGER DE CAMÉRA', course: 'Circuit', weather: 'Météo', laps: 'Tours', opponents: 'Adversaires', watercraft: 'Bateau', trackDefault: 'PAR DÉFAUT', level: 'NIVEAU', credits: 'CRÉDITS', races: 'COURSES', wins: 'VICTOIRES', medals: 'MÉDAILLES', boats: 'BATEAUX', upgrades: 'AMÉLIORATIONS', paint: 'PEINTURE', stripes: 'BANDES ET LOGOS', trail: 'SILLAGE ET TURBO', daily: 'DÉFI DU JOUR', weekly: 'DÉFI DE LA SEMAINE', completed: 'TERMINÉ', go: 'GO', locked: 'VERROUILLÉ', language: 'LANGUE', menuHint: '↑↓ choisir · ENTRÉE valider · ÉCHAP retour', quickSub: 'Six bateaux, trois tours, aucune pitié.', champSub: 'Une coupe de courses avec des points en jeu.', ttSub: 'Vous, le chrono et votre fantôme.', freeSub: 'Pas de chrono. Explorez, sautez, visez les anneaux.', stuntSub: 'Deux minutes. Saltos, dérapages, anneaux.', endlessSub: 'La mer monte sans cesse. Atteignez les portes.', battleSub: 'Bonus, torpilles, huile et boucliers.', careerSub: 'Huit rivaux. Battez-les un par un.', tutorialSub: 'Apprenez à déraper, booster, sauter et tourner.', splitSub: 'Deux joueurs, un écran.', dynWeather: 'Météo changeante', on: 'OUI', off: 'NON', bottles: 'BOUTEILLES',
};

const de: Dict = {
  play: 'SPIELEN', quick: 'SCHNELLES RENNEN', championship: 'MEISTERSCHAFT', timetrial: 'ZEITFAHREN', stunt: 'STUNT-LAUF', endless: 'ENDLOSE WELLE', freeride: 'FREIE FAHRT', battle: 'KAMPF', career: 'KARRIERE', tutorial: 'TUTORIAL', garage: 'GARAGE', settings: 'OPTIONEN', challenges: 'HERAUSFORDERUNGEN', achievements: 'ERFOLGE', splitscreen: '2 SPIELER', replays: 'WIEDERHOLUNG', back: 'ZURÜCK', start: 'START', continue: 'WEITER', resume: 'FORTSETZEN', restart: 'NEUSTART', quit: 'ZUM MENÜ', paused: 'PAUSE', photo: 'FOTOMODUS', watchReplay: 'WIEDERHOLUNG', raceAgain: 'NOCHMAL', changeCamera: 'KAMERA WECHSELN', course: 'Strecke', weather: 'Wetter', laps: 'Runden', opponents: 'Gegner', watercraft: 'Boot', trackDefault: 'STANDARD', level: 'STUFE', credits: 'CREDITS', races: 'RENNEN', wins: 'SIEGE', medals: 'MEDAILLEN', boats: 'BOOTE', upgrades: 'TUNING', paint: 'LACK', stripes: 'STREIFEN & DEKORE', trail: 'KIELWASSER & BOOST', daily: 'TAGES-AUFGABE', weekly: 'WOCHEN-AUFGABE', completed: 'ERLEDIGT', go: 'LOS', locked: 'GESPERRT', language: 'SPRACHE', menuHint: '↑↓ wählen · ENTER bestätigen · ESC zurück', quickSub: 'Sechs Boote, drei Runden, keine Gnade.', champSub: 'Ein Pokal voller Rennen um Punkte.', ttSub: 'Du, die Uhr und dein eigener Geist.', freeSub: 'Keine Uhr. Erkunden, springen, Ringe jagen.', stuntSub: 'Zwei Minuten. Saltos, Drifts, Ringe.', endlessSub: 'Das Meer steigt. Erreiche die Checkpoints.', battleSub: 'Itemboxen, Torpedos, Öl und Schilde.', careerSub: 'Acht Rivalen. Schlag sie einen nach dem anderen.', tutorialSub: 'Lerne Driften, Boosten, Springen und Saltos.', splitSub: 'Zwei Spieler, ein Bildschirm.', dynWeather: 'Wetterwechsel', on: 'AN', off: 'AUS', bottles: 'FLASCHEN',
};

const pt: Dict = {
  play: 'JOGAR', quick: 'CORRIDA RÁPIDA', championship: 'CAMPEONATO', timetrial: 'CONTRA O RELÓGIO', stunt: 'MANOBRAS', endless: 'ONDA SEM FIM', freeride: 'PASSEIO LIVRE', battle: 'BATALHA', career: 'CARREIRA', tutorial: 'TUTORIAL', garage: 'GARAGEM', settings: 'OPÇÕES', challenges: 'DESAFIOS', achievements: 'CONQUISTAS', splitscreen: '2 JOGADORES', replays: 'REPLAY', back: 'VOLTAR', start: 'COMEÇAR', continue: 'CONTINUAR', resume: 'RETOMAR', restart: 'REINICIAR', quit: 'SAIR PARA O MENU', paused: 'PAUSADO', photo: 'MODO FOTO', watchReplay: 'VER REPLAY', raceAgain: 'CORRER DE NOVO', changeCamera: 'MUDAR CÂMERA', course: 'Pista', weather: 'Clima', laps: 'Voltas', opponents: 'Rivais', watercraft: 'Embarcação', trackDefault: 'PADRÃO', level: 'NÍVEL', credits: 'CRÉDITOS', races: 'CORRIDAS', wins: 'VITÓRIAS', medals: 'MEDALHAS', boats: 'BARCOS', upgrades: 'MELHORIAS', paint: 'PINTURA', stripes: 'FAIXAS E ADESIVOS', trail: 'RASTRO E TURBO', daily: 'DESAFIO DIÁRIO', weekly: 'DESAFIO SEMANAL', completed: 'CONCLUÍDO', go: 'JÁ', locked: 'BLOQUEADO', language: 'IDIOMA', menuHint: '↑↓ escolher · ENTER confirmar · ESC voltar', quickSub: 'Seis barcos, três voltas, sem piedade.', champSub: 'Uma copa de corridas valendo pontos.', ttSub: 'Você, o relógio e seu próprio fantasma.', freeSub: 'Sem relógio. Explore, salte, pegue anéis.', stuntSub: 'Dois minutos. Piruetas, derrapagens, anéis.', endlessSub: 'O mar não para de subir. Alcance os portões.', battleSub: 'Caixas de itens, torpedos, óleo e escudos.', careerSub: 'Oito rivais. Vença um por um.', tutorialSub: 'Aprenda a derrapar, turbinar, saltar e girar.', splitSub: 'Dois jogadores, uma tela.', dynWeather: 'Clima variável', on: 'SIM', off: 'NÃO', bottles: 'GARRAFAS',
};

const DICTS: Record<Lang, Dict> = { en, es, fr, de, pt };
let current: Lang = 'en';

export function setLang(l: Lang) {
  current = LANGS.includes(l) ? l : 'en';
  document.documentElement.lang = current;
}
export function getLang() {
  return current;
}
export function t(key: string): string {
  return DICTS[current][key] ?? en[key] ?? key;
}
