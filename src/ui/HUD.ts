import type { Fighter } from "../entities/Fighter";
import type { FighterProfile } from "../core/types";
import type { Match } from "../core/Match";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`HUD element #${id} is missing`);
  return e as T;
}

export interface ResultData {
  win: boolean | null;
  method: string;
  detail: string;
  p1Name: string;
  p2Name: string;
  cards: Array<{ p1: number; p2: number }>;
  stats: Array<[string, string, string]>;
}

export class HUD {
  private root = el("hud");
  private p1Name = el("p1-name");
  private p2Name = el("p2-name");
  private p1Record = el("p1-record");
  private p2Record = el("p2-record");
  private p1Health = el("p1-health");
  private p2Health = el("p2-health");
  private p1HealthDmg = el("p1-health-dmg");
  private p2HealthDmg = el("p2-health-dmg");
  private p1Stamina = el("p1-stamina");
  private p2Stamina = el("p2-stamina");
  private roundLabel = el("round-label");
  private clock = el("clock");
  private ticker = el("ticker-text");
  private p1Punches = el("p1-punches");
  private p2Punches = el("p2-punches");
  private p1Acc = el("p1-acc");
  private p2Acc = el("p2-acc");
  private comboEl = el("combo");
  private calloutEl = el("callout");
  private promptEl = el("prompt");
  private dmgFlash = el("dmg-flash");
  private lowStamina = el("low-stamina");
  private controls = el("controls-hint");

  private lag1 = 100;
  private lag2 = 100;
  private tickerTimer = 0;
  private flashTimer = 0;
  private calloutTimer = 0;
  private totalRounds = 12;

  constructor() {
    this.root.classList.add("hidden");
  }

  setFighters(p1: FighterProfile, p2: FighterProfile, totalRounds: number): void {
    this.p1Name.textContent = p1.name.split(" ").slice(-1)[0].toUpperCase();
    this.p2Name.textContent = p2.name.split(" ").slice(-1)[0].toUpperCase();
    this.p1Record.textContent = p1.record;
    this.p2Record.textContent = p2.record;
    this.totalRounds = totalRounds;
    this.lag1 = 100;
    this.lag2 = 100;
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
  }

  setControlsVisible(v: boolean): void {
    this.controls.style.display = v ? "" : "none";
  }

  update(dt: number, p1: Fighter, p2: Fighter, match: Match, getup: number | null): void {
    /* health bars with a lagging "recent damage" chip */
    const h1 = (p1.health / 100) * 100;
    const h2 = (p2.health / 100) * 100;
    this.lag1 = Math.max(h1, this.lag1 - dt * 26);
    this.lag2 = Math.max(h2, this.lag2 - dt * 26);
    this.p1Health.style.width = `${h1}%`;
    this.p2Health.style.width = `${h2}%`;
    this.p1HealthDmg.style.left = `${h1}%`;
    this.p1HealthDmg.style.width = `${Math.max(0, this.lag1 - h1)}%`;
    this.p2HealthDmg.style.right = `${h2}%`;
    this.p2HealthDmg.style.width = `${Math.max(0, this.lag2 - h2)}%`;

    this.p1Stamina.style.width = `${(p1.stamina / 100) * 100}%`;
    this.p2Stamina.style.width = `${(p2.stamina / 100) * 100}%`;
    this.p1Stamina.classList.toggle("critical", p1.stamina < 25);
    this.p2Stamina.classList.toggle("critical", p2.stamina < 25);

    this.roundLabel.textContent =
      match.round === 1 && match.phase === "intro"
        ? "INTRODUCTIONS"
        : `ROUND ${match.round} / ${this.totalRounds}`;
    this.clock.textContent = match.clockString;
    this.clock.classList.toggle("danger", match.clock <= 10 && match.phase === "fight");

    this.p1Punches.textContent = String(p1.landed);
    this.p2Punches.textContent = String(p2.landed);
    this.p1Acc.textContent = p1.thrown ? `${Math.round((p1.landed / p1.thrown) * 100)}%` : "0%";
    this.p2Acc.textContent = p2.thrown ? `${Math.round((p2.landed / p2.thrown) * 100)}%` : "0%";
    this.comboEl.textContent = String(Math.max(p1.combo, p2.combo));

    this.lowStamina.classList.toggle("on", p1.stamina < 22 || p1.health < 18);

    if (this.tickerTimer > 0) {
      this.tickerTimer -= dt;
      if (this.tickerTimer <= 0) this.ticker.classList.remove("show");
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.dmgFlash.classList.remove("hit");
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.calloutEl.classList.remove("show");
    }
    void getup;
  }

  callout(text: string): void {
    this.calloutEl.textContent = text;
    this.calloutEl.classList.remove("show");
    void this.calloutEl.offsetWidth;
    this.calloutEl.classList.add("show");
    this.calloutTimer = 1.6;
  }

  tickerLine(text: string, seconds = 4.5): void {
    this.ticker.textContent = text;
    this.ticker.classList.add("show");
    this.tickerTimer = seconds;
  }

  prompt(text: string | null): void {
    if (!text) {
      this.promptEl.classList.add("hidden");
      return;
    }
    this.promptEl.textContent = text;
    this.promptEl.classList.remove("hidden");
  }

  flash(intensity = 1): void {
    this.dmgFlash.style.opacity = String(Math.min(1, 0.35 + intensity * 0.65));
    this.dmgFlash.classList.add("hit");
    this.flashTimer = 0.12;
  }
}

/* ==================================================================== */
/* Menu + results screens                                               */
/* ==================================================================== */

export class ResultsScreen {
  private screen = el("results");
  private banner = el("result-banner");
  private method = el("result-method");
  private cards = el("scorecards");
  private stats = el("fight-stats");
  onRematch: (() => void) | null = null;
  onMenu: (() => void) | null = null;

  constructor() {
    el("rematch-btn").addEventListener("click", () => this.onRematch?.());
    el("menu-btn").addEventListener("click", () => this.onMenu?.());
  }

  show(data: ResultData): void {
    this.banner.textContent = data.win === null ? "DRAW" : data.win ? "VICTORY" : "DEFEAT";
    this.banner.className = `result-banner${data.win === null ? " draw" : data.win ? "" : " loss"}`;
    this.method.textContent = data.detail ? `${data.method} \u00b7 ${data.detail}` : data.method;

    this.cards.innerHTML = data.cards.length
      ? data.cards
          .map((c, i) => {
            const winner =
              c.p1 === c.p2 ? "DRAW" : c.p1 > c.p2 ? data.p1Name : data.p2Name;
            return `<div class="scorecard"><div class="judge">JUDGE ${i + 1}</div><div class="card-num">${c.p1}-${c.p2}</div><div class="winner">${winner}</div></div>`;
          })
          .join("")
      : "";

    this.stats.innerHTML = data.stats
      .map(
        ([label, l, r]) =>
          `<div class="num l">${l}</div><div class="lbl">${label}</div><div class="num r">${r}</div>`,
      )
      .join("");

    this.screen.classList.remove("hidden");
  }

  hide(): void {
    this.screen.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.screen.classList.contains("hidden");
  }
}
