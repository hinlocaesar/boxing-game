import "./style.css";
import { Game } from "./core/Game";

const canvas = document.getElementById("scene") as HTMLCanvasElement | null;

if (!canvas) {
  throw new Error("Canvas #scene not found");
}

declare global {
  interface Window {
    __ringOfFire?: Game;
  }
}

window.__ringOfFire = new Game(canvas);
