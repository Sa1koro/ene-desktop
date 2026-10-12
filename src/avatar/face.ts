import { CanvasTexture, SRGBColorSpace } from "three";
import type { Emotion } from "../emotion";

export type FaceState = {
  emotion: Emotion;
  /** 0 = open, 1 = closed. */
  blink: number;
  /** 0 = closed, 1 = wide open. */
  mouth: number;
  /** Pupil offset, -1..1. */
  lookX: number;
  lookY: number;
  /** Extra blush, 0..1 (pokes, compliments). */
  blush: number;
};

const SIZE = 512;
const LINE = "#1b2340";
const IRIS = "#2fb4ef";
const IRIS_DARK = "#145f9e";

/**
 * Anime face painted on a canvas and wrapped onto the front of the head.
 * Redrawn only when the state changes, so it costs almost nothing per frame.
 */
export class Face {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private lastKey = "";

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  draw(s: FaceState) {
    const key = [
      s.emotion,
      s.blink.toFixed(2),
      s.mouth.toFixed(2),
      s.lookX.toFixed(2),
      s.lookY.toFixed(2),
      s.blush.toFixed(2),
    ].join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    c.lineCap = "round";
    c.lineJoin = "round";

    this.drawBlush(s);
    this.drawBrows(s.emotion);
    for (const side of [-1, 1] as const) this.drawEye(side, s);
    this.drawMouth(s);
    if (s.emotion === "sad") this.drawTear();
    if (s.emotion === "angry") this.drawAngerMark();
    this.texture.needsUpdate = true;
  }

  private eyeCenter(side: -1 | 1) {
    return { x: SIZE / 2 + side * 92, y: 238 };
  }

  private drawEye(side: -1 | 1, s: FaceState) {
    const c = this.ctx;
    const { x, y } = this.eyeCenter(side);
    const e = s.emotion;

    // Closed-arc eyes: happy ^ ^, excited >< on blink.
    if (e === "happy" || (e === "excited" && s.blink > 0.5)) {
      c.strokeStyle = LINE;
      c.lineWidth = 11;
      c.beginPath();
      if (e === "excited") {
        c.moveTo(x - side * 30, y - 24);
        c.lineTo(x + side * 22, y);
        c.lineTo(x - side * 30, y + 24);
      } else {
        c.arc(x, y + 14, 34, Math.PI * 1.15, Math.PI * 1.85);
      }
      c.stroke();
      return;
    }

    let open = 1 - s.blink;
    let ry = 50;
    let rx = 34;
    if (e === "smug") open *= 0.5;
    if (e === "angry") open *= 0.62;
    if (e === "sad") open *= 0.8;
    if (e === "surprised") {
      ry = 56;
      rx = 38;
    }

    if (open < 0.12) {
      c.strokeStyle = LINE;
      c.lineWidth = 10;
      c.beginPath();
      c.moveTo(x - 32, y + 8);
      c.quadraticCurveTo(x, y + 20, x + 32, y + 8);
      c.stroke();
      return;
    }

    // Eye white + iris, clipped by the lids.
    c.save();
    c.beginPath();
    c.ellipse(x, y, rx, ry * open, 0, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "#ffffff";
    c.fillRect(x - rx, y - ry, rx * 2, ry * 2);

    const lookX = s.lookX * 10;
    const lookY = s.lookY * 8 + (e === "thinking" ? -14 : 0);
    const irisR = e === "surprised" ? 20 : 29;
    const grad = c.createLinearGradient(0, y - irisR, 0, y + irisR);
    grad.addColorStop(0, IRIS_DARK);
    grad.addColorStop(1, IRIS);
    c.fillStyle = grad;
    c.beginPath();
    c.ellipse(x + lookX, y + lookY + 4, irisR, irisR * 1.25, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = LINE;
    c.beginPath();
    c.ellipse(x + lookX, y + lookY + 6, irisR * 0.45, irisR * 0.6, 0, 0, Math.PI * 2);
    c.fill();

    // Highlights; excited gets star sparkles.
    c.fillStyle = "#ffffff";
    if (e === "excited") this.star(x + lookX - 6, y + lookY - 6, 14);
    else {
      c.beginPath();
      c.ellipse(x + lookX - 10, y + lookY - 12, 9, 12, -0.4, 0, Math.PI * 2);
      c.fill();
    }
    c.beginPath();
    c.arc(x + lookX + 11, y + lookY + 16, 4.5, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // Upper lash line.
    c.strokeStyle = LINE;
    c.lineWidth = 9;
    c.beginPath();
    const top = y - ry * open;
    c.moveTo(x - rx - 6, y - ry * open * 0.55);
    c.quadraticCurveTo(x, top - 10, x + rx + 6, y - ry * open * 0.5 - side * 4);
    c.stroke();
  }

  private drawBrows(e: Emotion) {
    const c = this.ctx;
    c.strokeStyle = "#2a7fb8";
    c.lineWidth = 8;
    for (const side of [-1, 1]) {
      const x = SIZE / 2 + side * 92;
      let inner = 168;
      let outer = 164;
      if (e === "angry") [inner, outer] = [182, 154];
      if (e === "sad") [inner, outer] = [154, 174];
      if (e === "surprised") [inner, outer] = [146, 148];
      if (e === "smug") [inner, outer] = side === 1 ? [158, 150] : [170, 168];
      c.beginPath();
      c.moveTo(x - side * 28, inner);
      c.quadraticCurveTo(x, Math.min(inner, outer) - 8, x + side * 34, outer);
      c.stroke();
    }
  }

  private drawMouth(s: FaceState) {
    const c = this.ctx;
    const x = SIZE / 2;
    const y = 352;
    const open = s.mouth;
    c.strokeStyle = LINE;
    c.lineWidth = 7;

    if (open > 0.08) {
      // Talking: open mouth whose shape still follows the mood.
      const w = s.emotion === "surprised" ? 18 : 26;
      const h = 8 + open * 26;
      c.fillStyle = "#7a2335";
      c.beginPath();
      if (s.emotion === "happy" || s.emotion === "excited" || s.emotion === "smug") {
        c.moveTo(x - w - 6, y - 4);
        c.quadraticCurveTo(x, y - 8, x + w + 6, y - 4);
        c.quadraticCurveTo(x, y + h * 1.6, x - w - 6, y - 4);
      } else {
        c.ellipse(x, y + h / 2 - 4, w, h, 0, 0, Math.PI * 2);
      }
      c.fill();
      c.stroke();
      c.fillStyle = "#ff8fa3";
      c.beginPath();
      c.ellipse(x, y + h * 0.8, w * 0.55, h * 0.35, 0, 0, Math.PI * 2);
      c.fill();
      return;
    }

    c.beginPath();
    switch (s.emotion) {
      case "happy":
      case "excited":
        c.fillStyle = "#7a2335";
        c.moveTo(x - 30, y - 6);
        c.quadraticCurveTo(x, y + 40, x + 30, y - 6);
        c.closePath();
        c.fill();
        c.stroke();
        return;
      case "smug": // cat mouth
        c.moveTo(x - 30, y - 4);
        c.quadraticCurveTo(x - 15, y + 12, x, y - 2);
        c.quadraticCurveTo(x + 15, y + 12, x + 30, y - 8);
        break;
      case "angry": // pout
        c.moveTo(x - 14, y + 6);
        c.lineTo(x, y - 6);
        c.lineTo(x + 14, y + 6);
        break;
      case "surprised":
        c.ellipse(x, y + 2, 10, 13, 0, 0, Math.PI * 2);
        break;
      case "sad":
        c.moveTo(x - 24, y + 8);
        c.quadraticCurveTo(x, y - 10, x + 24, y + 8);
        break;
      case "thinking":
        c.moveTo(x - 14, y + 2);
        c.lineTo(x + 18, y - 2);
        break;
      default:
        c.moveTo(x - 18, y);
        c.quadraticCurveTo(x, y + 12, x + 18, y);
    }
    c.stroke();
  }

  private drawBlush(s: FaceState) {
    const c = this.ctx;
    const base = s.emotion === "happy" || s.emotion === "excited" ? 0.55 : 0.28;
    const amount = Math.min(1, base + s.blush * 0.7 + (s.emotion === "angry" ? 0.25 : 0));
    for (const side of [-1, 1]) {
      const x = SIZE / 2 + side * 128;
      const g = c.createRadialGradient(x, 318, 4, x, 318, 52);
      g.addColorStop(0, `rgba(255,120,150,${0.55 * amount})`);
      g.addColorStop(1, "rgba(255,120,150,0)");
      c.fillStyle = g;
      c.fillRect(x - 60, 260, 120, 120);
      if (amount > 0.5) {
        c.strokeStyle = `rgba(230,80,110,${amount * 0.8})`;
        c.lineWidth = 4;
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(x + i * 16 - 6, 330);
          c.lineTo(x + i * 16 + 6, 312);
          c.stroke();
        }
      }
    }
  }

  private drawTear() {
    const c = this.ctx;
    const x = SIZE / 2 + 118;
    c.fillStyle = "rgba(140,210,255,0.9)";
    c.beginPath();
    c.moveTo(x, 270);
    c.quadraticCurveTo(x + 14, 300, x, 306);
    c.quadraticCurveTo(x - 14, 300, x, 270);
    c.fill();
  }

  private drawAngerMark() {
    const c = this.ctx;
    const x = SIZE / 2 + 170;
    const y = 120;
    c.strokeStyle = "#e8344e";
    c.lineWidth = 8;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      c.beginPath();
      c.moveTo(x + dx * 8, y + dy * 22);
      c.quadraticCurveTo(x + dx * 8, y + dy * 8, x + dx * 22, y + dy * 8);
      c.stroke();
    }
  }

  private star(x: number, y: number, r: number) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.35;
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
  }
}
