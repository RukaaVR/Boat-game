/**
 * Loading screen. Drives the #boot overlay from index.html for the first
 * load and reuses it for race loads (course builds are synchronous, so the
 * overlay is painted first, then the build runs).
 *
 * The bar only moves when a real step completes (fonts, course build, first
 * frame / shader compile) — no fake progress, no artificial minimum time:
 * if everything is ready quickly the overlay simply fades out.
 */

const TIPS = [
  'DRIFT THROUGH TIGHT CORNERS TO BUILD MINI-TURBO.',
  'PERFECT LANDINGS REWARD CLEAN TRICK TIMING.',
  "SHORTCUTS SAVE TIME — BUT THEY'RE RISKIER.",
  'WATCH THE WAVES. BIGGER SWELLS CAN LAUNCH YOU.',
  'SAVE NITRO FOR THE FINAL STRETCH.',
  'HIT THE THROTTLE ON "1" FOR A PERFECT START.',
  'HOLD A DRIFT LONGER: BLUE → ORANGE → PURPLE SPARKS.',
  'JUMP A HOMING SEEKER AT THE LAST MOMENT TO DODGE IT.',
  'CUSTOMISE YOUR RIDER FROM THE MAIN MENU: RIDER.',
];

export class Loader {
  private el: HTMLElement | null;
  private bar: HTMLElement | null = null;
  private step: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private place: HTMLElement | null = null;
  private tipTimer = 0;
  private tipIdx = Math.floor(Math.random() * TIPS.length);

  constructor() {
    this.el = document.getElementById('boot');
    if (!this.el) return;
    this.el.innerHTML = `
      <div class="boot-sea"><i></i><i></i><i></i></div>
      <div class="boot-card">
        <svg class="boot-art" viewBox="0 0 120 60" aria-hidden="true">
          <path d="M8 44 C30 36 52 52 74 44 S112 40 118 44 L118 60 L8 60 Z" fill="#7fe3ff"/>
          <path d="M22 40 L86 40 C98 40 104 34 108 28 L30 30 C24 30 20 34 22 40 Z" fill="#ff4f8b" stroke="#12306e" stroke-width="3" stroke-linejoin="round"/>
          <path d="M40 30 L50 20 L60 30 Z" fill="#fff" stroke="#12306e" stroke-width="3" stroke-linejoin="round"/>
          <circle cx="56" cy="13" r="7" fill="#ffdcc4" stroke="#12306e" stroke-width="3"/>
          <path d="M49 10 L52 3 L55 8 L58 1 L60 8 L64 4 L63 11 Z" fill="#f3e0a8" stroke="#12306e" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M6 46 C14 44 18 48 26 46" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
        </svg>
        <div class="boot-logo">RIPTIDE</div>
        <div class="boot-place"></div>
        <div class="boot-bar"><div></div></div>
        <div class="boot-step"></div>
        <div class="boot-tip"></div>
      </div>`;
    this.bar = this.el.querySelector('.boot-bar div');
    this.step = this.el.querySelector('.boot-step');
    this.tip = this.el.querySelector('.boot-tip');
    this.place = this.el.querySelector('.boot-place');
  }

  /** Show the overlay (for race loads) and return after it has painted. */
  async show(place: string) {
    if (!this.el) return;
    this.el.classList.remove('gone');
    this.el.classList.add('again');
    this.set(0.05, 'PREPARING');
    if (this.place) this.place.textContent = place;
    this.startTips();
    // Two frames: one to apply styles, one to paint.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }

  setPlace(place: string) {
    if (this.place) this.place.textContent = place;
  }

  /** Advance the bar to `p` (0..1) with a label for the real step running. */
  set(p: number, label: string) {
    if (this.bar) this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    if (this.step) this.step.textContent = label;
  }

  private startTips() {
    window.clearInterval(this.tipTimer);
    // The first tip only appears if loading takes a moment.
    if (this.tip) this.tip.textContent = '';
    this.tipTimer = window.setInterval(() => {
      if (!this.tip) return;
      this.tip.textContent = 'TIP · ' + TIPS[this.tipIdx++ % TIPS.length];
      this.tip.classList.remove('in');
      void this.tip.offsetWidth;
      this.tip.classList.add('in');
    }, 1400);
  }

  hide() {
    window.clearInterval(this.tipTimer);
    this.set(1, 'READY');
    setTimeout(() => this.el?.classList.add('gone'), 120);
  }

  begin() {
    this.startTips();
  }
}
