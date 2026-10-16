import { ROSTER, getProfile } from "../data/roster";
import type { Difficulty, FighterProfile, MatchSettings } from "../core/types";
import { makeFighterPortrait } from "../render/textures";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Menu element #${id} is missing`);
  return e as T;
}

/** Total attribute score, used to auto-select a credible opponent. */
function rating(f: FighterProfile): number {
  const a = f.attrs;
  return a.power + a.speed + a.chin + a.stamina + a.accuracy + a.footwork;
}

export class Menu {
  private menuEl = el("menu");
  private pauseEl = el("pause");
  private pauseStats = el("pause-stats");
  private rosterEl = el("roster");
  private loadEl = el("loading");

  onStart: ((s: MatchSettings) => void) | null = null;
  onResume: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  private selectedId = ROSTER[0].id;

  constructor() {
    this.buildRoster();
    this.wireSegments();
    el("start-btn").addEventListener("click", () => this.start());
    el("resume-btn").addEventListener("click", () => this.onResume?.());
    el("quit-btn").addEventListener("click", () => this.onQuit?.());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Enter" && this.visible) this.start();
    });
    void this.loadEl;
  }

  private buildRoster(): void {
    this.rosterEl.innerHTML = "";
    for (const f of ROSTER) {
      const tile = document.createElement("div");
      tile.className = "fighter-tile" + (f.id === this.selectedId ? " selected" : "");
      tile.dataset.id = f.id;
      tile.innerHTML = `
        <div class="portrait" style="background-image:url('${makeFighterPortrait(f)}')"></div>
        <div class="tinfo">
          <div class="tname">${f.name.split(" ").slice(-1)[0]}</div>
          <div class="tnick">${f.nickname}<em class="style-inline">${f.style.toUpperCase()}</em></div>
          <div class="tstat">POW ${Math.round(f.attrs.power * 100)} · SPD ${Math.round(f.attrs.speed * 100)} · CHN ${Math.round(f.attrs.chin * 100)}</div>
        </div>
      `;
      tile.addEventListener("click", () => this.select(f.id));
      this.rosterEl.appendChild(tile);
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    for (const t of Array.from(this.rosterEl.children)) {
      t.classList.toggle("selected", (t as HTMLElement).dataset.id === id);
    }
  }

  private wireSegments(): void {
    for (const seg of Array.from(document.querySelectorAll<HTMLElement>("[data-seg]"))) {
      for (const btn of Array.from(seg.querySelectorAll<HTMLButtonElement>("button"))) {
        btn.addEventListener("click", () => {
          for (const b of Array.from(seg.querySelectorAll<HTMLButtonElement>("button"))) {
            b.classList.toggle("on", b === btn);
          }
        });
      }
    }
  }

  private readSeg(name: string): string {
    const btn = document.querySelector<HTMLElement>(`[data-seg="${name}"] button.on`);
    return btn?.dataset.val ?? "";
  }

  private pickOpponent(playerId: string): FighterProfile {
    const others = ROSTER.filter((f) => f.id !== playerId);
    others.sort((a, b) => rating(b) - rating(a));
    // The strongest realistic opponent, with a little variety.
    const pool = others.slice(0, Math.max(2, Math.ceil(others.length * 0.6)));
    return pool[(Math.random() * pool.length) | 0] ?? others[0];
  }

  get settings(): MatchSettings {
    const player = getProfile(this.selectedId);
    const opponent = this.pickOpponent(player.id);
    return {
      playerProfileId: player.id,
      opponentProfileId: opponent.id,
      rounds: parseInt(this.readSeg("rounds") || "12", 10),
      roundSeconds: parseInt(this.readSeg("roundlen") || "180", 10),
      difficulty: (this.readSeg("difficulty") || "pro") as Difficulty,
      aiRating: parseFloat(this.readSeg("ailevel") || "0.85"),
      audio: el<HTMLInputElement>("toggle-audio").checked,
    };
  }

  private start(): void {
    if (!this.visible) return;
    this.onStart?.(this.settings);
  }

  showLoading(): void {
    this.loadEl.classList.remove("hidden", "fade");
  }

  hideLoading(): void {
    this.loadEl.classList.add("fade");
    window.setTimeout(() => this.loadEl.classList.add("hidden"), 520);
  }

  get visible(): boolean {
    return !this.menuEl.classList.contains("hidden");
  }

  hide(): void {
    this.menuEl.classList.add("hidden");
  }

  show(): void {
    this.menuEl.classList.remove("hidden");
    this.pauseEl.classList.add("hidden");
  }

  showPause(summary: string): void {
    this.pauseStats.innerHTML = summary;
    this.pauseEl.classList.remove("hidden");
  }

  hidePause(): void {
    this.pauseEl.classList.add("hidden");
  }

  get paused(): boolean {
    return !this.pauseEl.classList.contains("hidden");
  }
}
