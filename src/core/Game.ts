import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

import { buildArena, type Arena } from "../render/Arena";
import { buildRing, type Ring } from "../render/Ring";
import { CameraRig } from "../render/CameraRig";
import { Effects } from "../render/Effects";
import { loadBoxerTemplate, type BoxerTemplate } from "../render/BoxerBody";
import { AudioEngine } from "../audio/AudioEngine";
import { Input } from "./Input";
import { Match } from "./Match";
import { Fighter, type ActivePunch } from "../entities/Fighter";
import { AIController } from "../entities/AIController";
import { HUD, ResultsScreen, type ResultData } from "../ui/HUD";
import { Menu } from "../ui/Menu";
import { getProfile } from "../data/roster";
import { BODY_MODIFIERS, VITALS } from "./constants";
import type { MatchSettings } from "./types";

/* ------------------------------------------------------------------ */
/* Commentary                                                          */
/* ------------------------------------------------------------------ */

const LINES = {
  roundStart: [
    "Here we go — the bell has rung!",
    "Both fighters come out of their corners.",
    "The referee waves them on. Boxing!",
  ],
  bigHit: [
    "Oh, that landed flush!",
    "A thunderous shot connects!",
    "The crowd is on its feet!",
    "You could hear that one in the cheap seats!",
    "A picture-perfect combination!",
  ],
  bodyShot: [
    "That one went downstairs — right to the midsection!",
    "A thudding body shot!",
  ],
  block: ["Blocked! Good defence from the guard.", "Shoulder roll — nothing doing there."],
  slip: ["Slipped! Just beyond the range of that one.", "A clean slip, and the counter is coming!"],
  knockdown: ["HE'S DOWN! The referee sends the challenger to a neutral corner!", "A KNOCKDOWN! This could be the beginning of the end!"],
  tenSeconds: ["Ten seconds remaining in the round!", "The round is winding down!"],
  roundOver: ["That's the bell! End of the round.", "The round comes to a close."],
  tired: ["The arms are getting heavy now.", "Fatigue is starting to show."],
  clinch: ["They tie up in close.", ""],
  ko: ["IT'S ALL OVER!", "The referee has seen enough!"],
  decision: ["We go to the scorecards!", "The judges will decide this one!"],
};

function pick(lines: string[]): string {
  return lines[(Math.random() * lines.length) | 0];
}

/* ================================================================== */

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: CameraRig;
  private arena: Arena;
  private ring: Ring;
  private effects = new Effects();
  private audio = new AudioEngine();
  private input = new Input();
  private hud = new HUD();
  private menu = new Menu();
  private results = new ResultsScreen();
  private composer: EffectComposer | null = null;

  /** Downloaded boxer mesh, shared by every fighter once it has loaded. */
  private boxer: BoxerTemplate | null = null;
  private boxerFailed = false;

  private clock = { last: performance.now() };
  private raf = 0;

  private p1: Fighter | null = null;
  private p2: Fighter | null = null;
  private ai: AIController | null = null;
  private match: Match | null = null;
  private settings: MatchSettings | null = null;

  private paused = false;
  private overTimer = 0;
  private resultsShown = false;

  private kdVictim: Fighter | null = null;
  private kdAttacker: Fighter | null = null;
  private downActive = false;
  private countElapsed = 0;
  private countNumber = 0;
  private getupProgress = 0;
  private getupNeeded = 7;

  private commentaryCooldown = 0;
  private excitement = 0.25;
  private menuAngle = 0.7;
  private demo: Fighter[] = [];
  private firstFrame = true;

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;

    this.scene.fog = new THREE.FogExp2(0x05070e, 0.018);
    this.scene.background = new THREE.Color(0x04060b);

    this.cam = new CameraRig(window.innerWidth / window.innerHeight);

    this.ring = buildRing();
    this.scene.add(this.ring.group);

    this.arena = buildArena();
    this.scene.add(this.arena.group);

    this.scene.add(this.effects.group);
    this.cam.setGround(this.ring.canvasY);
    this.cam.setBounds(this.ring.bound);

    this.setupComposer();

    this.menu.onStart = (s) => void this.startMatch(s);
    this.menu.onResume = () => this.setPaused(false);
    this.menu.onQuit = () => this.quitToMenu();
    this.results.onRematch = () => {
      this.results.hide();
      if (this.settings) void this.startMatch(this.settings);
    };
    this.results.onMenu = () => {
      this.results.hide();
      this.quitToMenu();
    };

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);

    this.menu.show();
    this.loop();
    void this.preloadBoxer();
  }

  /** Fetches the boxer mesh in the background so the menu still animates. */
  private preloadBoxer(): Promise<BoxerTemplate | null> {
    if (this.boxer || this.boxerFailed) return Promise.resolve(this.boxer);
    return loadBoxerTemplate().then(
      (tpl) => {
        this.boxer = tpl;
        if (this.demo.length === 0 && !this.settings) this.spawnDemoFighters();
        return tpl;
      },
      (err: unknown) => {
        this.boxerFailed = true;
        console.error("Could not load the boxer model:", err);
        this.hud.tickerLine("Boxer model failed to load — check assets/raw/Brute.glb", 8);
        return null;
      },
    );
  }

  /* ---------------------------------------------------------------- */

  private setupComposer(): void {
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.cam.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.3,
        0.5,
        0.94,
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      composer.setSize(window.innerWidth, window.innerHeight);
      this.composer = composer;
    } catch (err) {
      console.warn("Post-processing unavailable, falling back to direct render.", err);
      this.composer = null;
    }
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.cam.setAspect(w / h);
  };

  private onVisibility = (): void => {
    if (document.hidden && this.settings && !this.match?.finished) this.setPaused(true);
  };

  /* ---------------------------------------------------------------- */
  /* Menu scene                                                        */
  /* ---------------------------------------------------------------- */

  private spawnDemoFighters(): void {
    const boxer = this.boxer;
    if (!boxer) return;
    const a = new Fighter(getProfile("calloway"), 0, this.audio, boxer);
    const b = new Fighter(getProfile("volkov"), 1, this.audio, boxer);
    for (const f of [a, b]) {
      f.groundY = this.ring.canvasY;
      f.bound = this.ring.bound;
    }
    a.place(0.7, -0.5, 0);
    b.place(-0.7, 0.5, 0);
    a.yaw = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    b.yaw = Math.atan2(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    a.container.rotation.y = a.yaw;
    b.container.rotation.y = b.yaw;
    this.scene.add(a.container, b.container);
    this.demo = [a, b];
  }

  private clearDemoFighters(): void {
    for (const f of this.demo) {
      this.scene.remove(f.container);
      f.dispose();
    }
    this.demo = [];
  }

  private updateMenuScene(dt: number): void {
    this.menuAngle += dt * 0.09;
    const r = 7.4;
    const y = this.ring.canvasY + 2.35;
    this.cam.camera.position.lerp(
      this.tmpA.set(Math.sin(this.menuAngle) * r, y, Math.cos(this.menuAngle) * r),
      Math.min(1, dt * 2),
    );
    this.cam.camera.lookAt(0, this.ring.canvasY + 1.05, 0);

    if (this.demo.length === 2) {
      this.demo[0].update(dt, this.demo[1], false);
      this.demo[1].update(dt, this.demo[0], false);
    }
    this.arena.update(dt, this.tmpB.set(0, this.ring.canvasY, 0));
    this.effects.update(dt, 0.16);
    this.excitement = 0.16;
  }

  /* ---------------------------------------------------------------- */
  /* Match lifecycle                                                   */
  /* ---------------------------------------------------------------- */

  async startMatch(settings: MatchSettings): Promise<void> {
    this.audio.setEnabled(settings.audio);
    await this.audio.unlock();
    if (settings.audio) this.audio.setExcitement(0.5);

    const boxer = this.boxer ?? (await this.preloadBoxer());
    if (!boxer) return;

    this.clearDemoFighters();
    this.disposeFighters();

    const playerProfile = getProfile(settings.playerProfileId);
    const oppProfile = getProfile(settings.opponentProfileId);

    const p1 = new Fighter(playerProfile, 0, this.audio, boxer);
    const p2 = new Fighter(oppProfile, 1, this.audio, boxer);
    for (const f of [p1, p2]) {
      f.groundY = this.ring.canvasY;
      f.bound = this.ring.bound;
    }

    p1.place(0.95, -0.75, 0);
    p2.place(-0.95, 0.75, 0);
    p1.yaw = Math.atan2(p2.pos.x - p1.pos.x, p2.pos.z - p1.pos.z);
    p2.yaw = p1.yaw + Math.PI;
    p1.container.rotation.y = p1.yaw;
    p2.container.rotation.y = p2.yaw;

    p1.events.impact = (f, punch) => this.resolveImpact(f, punch);
    p2.events.impact = (f, punch) => this.resolveImpact(f, punch);

    this.scene.add(p1.container, p2.container);
    this.p1 = p1;
    this.p2 = p2;

    this.ai = new AIController(oppProfile, settings.difficulty, settings.aiRating);
    this.match = new Match(settings.rounds, settings.roundSeconds, 3);
    this.settings = settings;

    this.hud.setFighters(playerProfile, oppProfile, settings.rounds);
    this.hud.show();
    this.hud.setControlsVisible(true);
    this.hud.prompt(null);
    this.results.hide();
    this.menu.hide();
    this.menu.hideLoading();

    this.effects.clear();
    this.cam.reset();
    this.paused = false;
    this.resultsShown = false;
    this.overTimer = 0;
    this.downActive = false;
    this.kdVictim = null;
    this.kdAttacker = null;

    this.match.startRound(1);
    this.hud.callout("BOX!");
    this.hud.tickerLine(pick(LINES.roundStart), 5);

    this.input.enabled = true;
  }

  private disposeFighters(): void {
    for (const f of [this.p1, this.p2]) {
      if (!f) continue;
      this.scene.remove(f.container);
      f.dispose();
    }
    this.p1 = null;
    this.p2 = null;
  }

  quitToMenu(): void {
    this.setPaused(false);
    this.disposeFighters();
    this.input.enabled = false;
    this.hud.hide();
    this.hud.prompt(null);
    this.results.hide();
    this.match = null;
    this.settings = null;
    this.audio.setExcitement(0.16);
    this.cam.reset();
    this.spawnDemoFighters();
    this.menu.show();
  }

  private setPaused(v: boolean): void {
    this.paused = v;
    if (v) {
      const m = this.match;
      const p1 = this.p1;
      const p2 = this.p2;
      if (m && p1 && p2) {
        this.menu.showPause(
          `ROUND ${m.round} OF ${m.totalRoundsCount}<br/>` +
            `SCORECARD ${m.scoreText()}<br/>` +
            `${p1.profile.name}: ${Math.round(p1.health)}% &nbsp; ${p2.profile.name}: ${Math.round(p2.health)}%`,
        );
      } else {
        this.menu.showPause("PAUSED");
      }
    } else {
      this.menu.hidePause();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Main loop                                                         */
  /* ---------------------------------------------------------------- */

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.0005, (now - this.clock.last) / 1000));
    this.clock.last = now;
    this.frame(dt);
  };

  private frame(dt: number): void {
    const f = this.input.poll();
    this.commentaryCooldown = Math.max(0, this.commentaryCooldown - dt);

    if (f.pause && this.settings) this.setPaused(!this.paused);

    if (this.paused) {
      this.render();
      return;
    }

    if (this.settings && this.match && this.p1 && this.p2) {
      this.updateMatch(dt, f);
    } else {
      this.updateMenuScene(dt);
    }

    this.audio.update(dt);
    this.render();

    if (this.firstFrame) {
      this.firstFrame = false;
      this.menu.hideLoading();
    }
  }

  private updateMatch(dt: number, f: ReturnType<Input["poll"]>): void {
    const m = this.match!;
    const p1 = this.p1!;
    const p2 = this.p2!;

    const fighting = m.phase === "fight" || m.phase === "between" || m.phase === "intro";
    const allowControl = m.phase === "fight" && !p1.downed;

    /* ---- player input ---- */
    p1.intent.moveX = f.moveX;
    p1.intent.moveZ = f.moveZ;
    p1.intent.block = f.block;
    p1.intent.slip = f.slip;
    p1.intent.lean = f.lean;

    if (allowControl) {
      for (const kind of f.punches) {
        if (p1.tryPunch(kind, f.bodyMod ? "body" : "head")) this.audio.whiff();
      }
    }

    /* ---- opponent AI ---- */
    if (m.phase === "fight" && this.ai) this.ai.update(dt, p2, p1);
    else {
      p2.intent.moveX = 0;
      p2.intent.moveZ = 0;
      p2.intent.block = false;
      p2.intent.slip = 0;
    }

    /* ---- simulation ---- */
    p1.update(dt, p2, allowControl || m.phase === "between" || m.phase === "intro");
    p2.update(dt, p1, m.phase === "fight");

    /* ---- phase machine ---- */
    switch (m.phase) {
      case "intro":
        m.introTimer -= dt;
        if (m.introTimer <= 0) {
          this.audio.bell(1);
          m.beginFighting();
          this.hud.callout(`ROUND ${m.round}`);
          this.hud.tickerLine(pick(LINES.roundStart), 4);
        }
        break;

      case "fight": {
        const ev = m.tick(dt);
        if (ev === "ten") {
          this.hud.callout("10 SECONDS");
          this.hud.tickerLine(pick(LINES.tenSeconds), 3);
          this.audio.setExcitement(0.85);
        } else if (ev === "roundOver") {
          this.finishRound();
        }
        break;
      }

      case "between":
        m.betweenTimer -= dt;
        if (m.betweenTimer <= 0) {
          this.audio.bell(1);
          m.beginFighting();
          this.hud.callout(`ROUND ${m.round}`);
          this.hud.tickerLine(pick(LINES.roundStart), 4);
        }
        break;

      case "down":
        this.updateDown(dt, f);
        break;

      case "over":
        this.overTimer -= dt;
        if (this.overTimer <= 0 && !this.resultsShown) this.showResults();
        break;
    }

    /* ---- presentation ---- */
    const action = 0.2 + Math.max(p1.combo, p2.combo) * 0.16 + (1 - Math.min(p1.health, p2.health) / 100) * 0.5;
    this.excitement += (Math.min(1, action) - this.excitement) * Math.min(1, dt * 1.2);
    this.audio.setExcitement(this.excitement);

    if (m.phase !== "over") {
      this.cam.update(dt, p1, p2);
    } else {
      this.cam.update(dt, p1, p2);
    }

    this.hud.update(dt, p1, p2, m, this.downActive ? this.getupProgress : null);
    this.arena.update(dt, this.tmpA.set((p1.pos.x + p2.pos.x) / 2, this.ring.canvasY, (p1.pos.z + p2.pos.z) / 2));
    this.effects.update(dt, this.excitement);

    // Ambient tiredness commentary.
    if (fighting && this.commentaryCooldown <= 0 && Math.min(p1.stamina, p2.stamina) < 25) {
      this.hud.tickerLine(pick(LINES.tired), 3);
      this.commentaryCooldown = 12;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Combat                                                            */
  /* ---------------------------------------------------------------- */

  private resolveImpact(attacker: Fighter, punch: ActivePunch): void {
    if (punch.resolved) return;
    punch.resolved = true;

    const defender = attacker.team === 0 ? this.p2 : this.p1;
    if (!defender) return;

    const dx = defender.pos.x - attacker.pos.x;
    const dz = defender.pos.z - attacker.pos.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const dir = this.tmpA.set(dx / dist, 0, dz / dist);

    const body = punch.target === "body";
    const profile = punch.profile;
    const reach = attacker.reach + profile.reach + (body ? 0.1 : 0);

    const targetPos = body
      ? defender.chestWorld(this.tmpB)
      : defender.headWorld(this.tmpB);

    /* --- out of range --- */
    if (dist > reach + 0.32) {
      this.audio.whiff();
      this.effects.whiff(targetPos, dir);
      attacker.markMiss();
      return;
    }

    /* --- slipped --- */
    if (defender.invulnerable) {
      this.audio.whiff();
      this.effects.whiff(targetPos, dir);
      attacker.markMiss();
      if (Math.random() < 0.5) this.hud.tickerLine(pick(LINES.slip), 2.5);
      return;
    }

    /* --- accuracy --- */
    const acc =
      profile.accuracy *
      (0.75 + 0.25 * attacker.profile.attrs.accuracy) *
      attacker.staminaFactor *
      (body ? BODY_MODIFIERS.accuracy : 1);
    if (Math.random() > Math.min(0.9, acc)) {
      this.audio.whiff();
      this.effects.whiff(targetPos, dir);
      attacker.markMiss();
      return;
    }

    /* --- contact --- */
    const blocked = defender.blocking;
    const parried = blocked && defender.blockElapsed < 0.13 && Math.random() < 0.35;

    let power = profile.damage * attacker.profile.attrs.power * attacker.staminaFactor;
    if (body) power *= BODY_MODIFIERS.damage;
    const sweet = 1.55;
    if (dist > sweet) power *= Math.max(0.5, 1 - (dist - sweet) * 0.7);

    const stun = profile.stun * (body ? BODY_MODIFIERS.stun : 1) * attacker.profile.attrs.power;

    const wentDown = defender.takeHit(power, {
      target: punch.target,
      stun,
      fromDir: attacker.pos.x <= defender.pos.x ? 1 : -1,
      blocked,
      parried,
    });

    if (blocked) {
      this.effects.blockHit(targetPos, dir);
      this.cam.addShake(0.1);
      if (Math.random() < 0.18) this.hud.tickerLine(pick(LINES.block), 2.5);
    } else {
      attacker.registerLand(power, punch.target);
      this.effects.impact(targetPos, dir, Math.min(1.6, power / 9));
      this.cam.addShake(0.16 + power / 55);
      this.cam.punchFov(Math.min(4, power * 0.25));
      this.audio.setExcitement(Math.min(1, this.excitement + 0.12));
      if (defender === this.p1) this.hud.flash(Math.min(1, power / 18));

      if (this.commentaryCooldown <= 0 && power > 7) {
        this.hud.tickerLine(pick(body ? LINES.bodyShot : LINES.bigHit), 2.6);
        this.commentaryCooldown = 1.6;
      }
    }

    if (parried) {
      attacker.animator.kick(0.5);
      attacker.activePunch = null;
    }

    if (blocked || parried) return;

    /* --- knockdown checks --- */
    if (wentDown) {
      this.beginKnockdown(defender, attacker);
      return;
    }
    const kdChance =
      profile.knockChance *
      (0.35 + defender.stun / 70) *
      (defender.health < 30 ? 2.2 : 1) *
      (body ? 0.6 : 1);
    if (Math.random() < kdChance * 0.45) this.beginKnockdown(defender, attacker);
  }

  /* ---------------------------------------------------------------- */
  /* Knockdowns                                                        */
  /* ---------------------------------------------------------------- */

  private beginKnockdown(victim: Fighter, attacker: Fighter): void {
    const m = this.match;
    if (!m || this.downActive) return;

    this.kdVictim = victim;
    this.kdAttacker = attacker;
    this.downActive = true;
    this.countElapsed = 0;
    this.countNumber = 0;
    this.getupProgress = 0;

    const dir = attacker.pos.x <= victim.pos.x ? 1 : -1;
    victim.knockDown(dir);
    this.audio.gong();
    this.audio.setExcitement(1);
    this.effects.dust(this.tmpA.set(victim.pos.x, this.ring.canvasY, victim.pos.z), 1.5);

    this.cam.focusOn(this.tmpB.set(victim.pos.x, this.ring.canvasY + 0.25, victim.pos.z), Math.random() * Math.PI * 2);
    this.hud.callout("KNOCKDOWN!");
    this.hud.tickerLine(pick(LINES.knockdown), 4);
    m.phase = "down";

    if (victim === this.p1) {
      this.getupNeeded = 6 + victim.knockCount * 2;
      this.hud.prompt("MASH  SPACE  TO  RISE");
    } else {
      this.hud.prompt(null);
    }
  }

  private updateDown(dt: number, f: ReturnType<Input["poll"]>): void {
    const v = this.kdVictim;
    const m = this.match;
    if (!v || !m) return;

    this.countElapsed += dt;

    const REF_DELAY = 1.15;
    if (this.countElapsed > REF_DELAY) {
      const n = Math.floor(this.countElapsed - REF_DELAY) + 1;
      if (n > this.countNumber) {
        this.countNumber = Math.min(10, n);
        this.audio.countBlip(this.countNumber);
        if (this.countNumber <= 9) this.hud.callout(String(this.countNumber));
      }
    }

    /* Three knockdowns in a round ends it immediately (TKO). */
    if (v.knockCount >= VITALS.maxKnockdownsPerRound && this.countElapsed > 1.4) {
      this.endFight(this.kdAttacker!.team, "TKO", "The referee has seen enough — three knockdowns in the round!");
      return;
    }

    /* Counted out — a fighter who cannot beat the count loses regardless of health. */
    if (this.countNumber >= 10) {
      v.stayDown();
      this.endFight(this.kdAttacker!.team, "Knockout", `${v.profile.name} is counted out!`);
      return;
    }

    /* Getting up. */
    if (v === this.p1) {
      if (f.mash > 0) {
        this.getupProgress += f.mash / this.getupNeeded;
        this.hud.prompt(
          `MASH  SPACE  TO  RISE   ${"▮".repeat(Math.min(10, Math.round(this.getupProgress * 10)))}`,
        );
      }
    } else {
      const rate = 1 / (1.35 + v.knockCount * 0.9);
      this.getupProgress += dt * rate;
    }

    if (this.getupProgress >= 1) {
      this.downActive = false;
      this.hud.prompt(null);
      this.hud.callout("UP!");
      v.startGetup();
      this.cam.stopKoOrbit();
      m.phase = "fight";
      this.hud.tickerLine(`${v.profile.name} beats the count!`, 3);
      this.audio.cheer(0.7);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Round / fight end                                                 */
  /* ---------------------------------------------------------------- */

  private finishRound(): void {
    const m = this.match!;
    const p1 = this.p1!;
    const p2 = this.p2!;
    this.audio.bell(3);
    const card = m.scoreRound(p1, p2);
    this.hud.tickerLine(`End of round ${m.round} — scored ${card.p1}-${card.p2}`, 4);
    this.hud.callout(`END OF ${m.round === 1 ? "1ST" : `ROUND ${m.round}`}`);

    p1.resetRound();
    p2.resetRound();
    this.ai?.reset();

    if (m.round >= m.totalRoundsCount) {
      m.decideByPoints();
      this.hud.tickerLine(pick(LINES.decision), 4);
      this.endFight(m.winner, m.method, m.detail);
    } else {
      m.startRound(m.round + 1);
    }
  }

  private endFight(winnerTeam: 0 | 1 | null, method: string, detail: string): void {
    const m = this.match!;
    const p1 = this.p1!;
    const p2 = this.p2!;
    if (m.phase === "over" && this.resultsShown) return;

    m.finish(winnerTeam, method, detail);
    this.downActive = false;
    this.hud.prompt(null);
    this.overTimer = 3.8;
    this.resultsShown = false;

    if (winnerTeam === null) {
      this.hud.callout("DRAW");
    } else {
      const w = winnerTeam === 0 ? p1 : p2;
      const l = winnerTeam === 0 ? p2 : p1;
      w.win();
      l.lose();
      this.cam.focusOn(this.tmpB.set(w.pos.x, this.ring.canvasY + 0.6, w.pos.z), Math.random() * Math.PI * 2);
      this.hud.callout(winnerTeam === 0 ? "YOU WIN" : "YOU LOSE");
      this.hud.tickerLine(method === "Knockout" || method === "TKO" ? pick(LINES.ko) : pick(LINES.decision), 4);
    }
    this.audio.bell(3);
    this.audio.cheer(1);
    this.audio.setExcitement(1);
  }

  private showResults(): void {
    this.resultsShown = true;
    const m = this.match!;
    const p1 = this.p1!;
    const p2 = this.p2!;
    const pct = (f: Fighter) => (f.thrown ? `${Math.round((f.landed / f.thrown) * 100)}%` : "0%");

    const data: ResultData = {
      win: m.winner === null ? null : m.winner === 0,
      method: m.method,
      detail: m.detail,
      p1Name: p1.profile.name,
      p2Name: p2.profile.name,
      cards: m.decided ? m.judges.map((j) => ({ p1: j.p1, p2: j.p2 })) : [],
      stats: [
        ["PUNCHES LANDED", String(p1.landed), String(p2.landed)],
        ["TOTAL THROWN", String(p1.thrown), String(p2.thrown)],
        ["ACCURACY", pct(p1), pct(p2)],
        ["KNOCKDOWNS", String(p1.knockTotal), String(p2.knockTotal)],
        ["BEST COMBO", String(p1.comboRate), String(p2.comboRate)],
        ["DAMAGE DEALT", String(Math.round(p1.totalDamage)), String(Math.round(p2.totalDamage))],
      ],
    };
    this.hud.hide();
    this.results.show(data);
    this.input.enabled = false;
  }

  /* ---------------------------------------------------------------- */

  private render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.cam.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.disposeFighters();
    this.clearDemoFighters();
    this.ring.dispose();
    this.arena.dispose();
    this.renderer.dispose();
  }
}
