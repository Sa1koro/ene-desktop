import {
  BackSide,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import type { Emotion } from "../emotion";
import { Face } from "./face";
import type { Avatar, BusyPose, Gesture } from "./types";

const PALETTE = {
  skin: 0xffe6da,
  hair: 0x3cbcf0,
  hairTip: 0x2a8fd0,
  jacket: 0x253a7a,
  trim: 0x5fe1ff,
  skirt: 0xf2f6ff,
  stockings: 0x1a1f3a,
  headphones: 0x16181f,
  outline: 0x141a2e,
};

const GESTURE_SECONDS: Record<Gesture, number> = {
  wave: 1.8,
  jump: 0.7,
  victory: 1.4,
  nod: 0.7,
  shake: 0.8,
  spin: 0.9,
  poke: 0.5,
};

function toonGradient() {
  const tex = new DataTexture(new Uint8Array([90, 175, 255]), 3, 1, RedFormat);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

type Spring = { angle: number; velocity: number };

/**
 * ENE built from primitives: toon-shaded, ink-outlined, with a canvas-painted
 * face and spring-simulated twin tails. No downloads, no model licensing.
 */
export class ChibiAvatar implements Avatar {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly headPivot = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly tails: Array<{ side: 1 | -1; joints: Group[]; springs: Spring[] }> = [];
  private readonly glowMats: MeshBasicMaterial[] = [];
  private readonly face = new Face();
  private readonly gradient = toonGradient();

  private emotion: Emotion = "neutral";
  private mouthTarget = 0;
  private mouth = 0;
  private look = { x: 0, y: 0, tx: 0, ty: 0 };
  private blink = { value: 0, nextAt: 2, closingUntil: 0 };
  private blush = 0;
  private blushHold = 0;
  private gesture: { name: Gesture; t: number } | null = null;
  private busy: BusyPose | null = null;
  private busyT = 0;
  private lastRootY = 0;
  private rootVY = 0;

  constructor() {
    this.root.add(this.body);
    this.buildBody();
    this.buildHead();
  }

  // ---------------------------------------------------------------- building

  private toon(color: number, extra: Partial<MeshToonMaterial> = {}) {
    return Object.assign(new MeshToonMaterial({ color, gradientMap: this.gradient }), extra);
  }

  private part(geometry: BufferGeometry, material: Material, outline = 0.035) {
    const mesh = new Mesh(geometry, material);
    if (outline > 0) {
      const ink = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: PALETTE.outline, side: BackSide }),
      );
      ink.scale.setScalar(1 + outline);
      mesh.add(ink);
    }
    return mesh;
  }

  private buildBody() {
    // Legs in dark stockings with cyan shoes.
    for (const side of [-1, 1]) {
      const leg = this.part(new CapsuleGeometry(0.13, 0.45, 6, 12), this.toon(PALETTE.stockings));
      leg.position.set(side * 0.18, 0.38, 0);
      const shoe = this.part(new SphereGeometry(0.16, 16, 12), this.toon(PALETTE.trim));
      shoe.scale.set(1, 0.6, 1.3);
      shoe.position.set(0, -0.32, 0.04);
      leg.add(shoe);
      this.body.add(leg);
    }

    const skirt = this.part(
      new ConeGeometry(0.62, 0.5, 24, 1, true),
      this.toon(PALETTE.skirt, { side: DoubleSide }),
    );
    skirt.position.y = 0.9;
    this.body.add(skirt);

    const torso = this.part(new CapsuleGeometry(0.38, 0.45, 8, 16), this.toon(PALETTE.jacket));
    torso.position.y = 1.2;
    torso.scale.set(1, 1, 0.82);
    this.body.add(torso);

    // Zipper line and collar trim.
    const zip = new Mesh(new CylinderGeometry(0.02, 0.02, 0.62), this.toon(PALETTE.trim));
    zip.position.set(0, 1.2, 0.315);
    this.body.add(zip);
    const collar = this.part(new TorusGeometry(0.24, 0.06, 8, 24), this.toon(PALETTE.trim), 0);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.55;
    this.body.add(collar);

    for (const [pivot, side] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      pivot.position.set(side * 0.42, 1.45, 0);
      const arm = this.part(new CapsuleGeometry(0.1, 0.36, 6, 10), this.toon(PALETTE.jacket));
      arm.position.y = -0.27;
      const hand = this.part(new SphereGeometry(0.11, 14, 10), this.toon(PALETTE.skin));
      hand.position.y = -0.55;
      pivot.add(arm, hand);
      pivot.rotation.z = side * 0.18;
      this.body.add(pivot);
    }

    this.headPivot.position.y = 1.55;
    this.body.add(this.headPivot);
  }

  private buildHead() {
    const head = new Group();
    head.position.y = 0.82;
    this.headPivot.add(head);

    const skull = this.part(new SphereGeometry(1, 40, 28), this.toon(PALETTE.skin), 0.025);
    skull.scale.set(1, 0.94, 0.92);
    head.add(skull);

    // Face decal: a sphere patch over the front, painted by Face.
    const faceW = 1.7;
    const faceMesh = new Mesh(
      new SphereGeometry(1.004, 40, 24, Math.PI / 2 - faceW / 2, faceW, 0.92, 1.3),
      new MeshBasicMaterial({ map: this.face.texture, transparent: true, depthWrite: false }),
    );
    faceMesh.scale.copy(skull.scale);
    head.add(faceMesh);

    const hairMat = this.toon(PALETTE.hair);
    const cap = this.part(new SphereGeometry(1.07, 40, 20, 0, Math.PI * 2, 0, 1.22), hairMat);
    cap.scale.set(1.02, 0.98, 0.97);
    head.add(cap);
    const back = this.part(new SphereGeometry(1.05, 32, 20, Math.PI, Math.PI, 0.8, 1.6), hairMat);
    back.position.z = -0.05;
    head.add(back);

    // Bangs: a fan of hair spikes across the forehead.
    for (let i = -3; i <= 3; i++) {
      const spike = this.part(new ConeGeometry(0.2, 0.62, 10), hairMat, 0.05);
      const a = i * 0.24;
      spike.position.set(Math.sin(a) * 0.95, 0.3 - Math.abs(i) * 0.03, Math.cos(a) * 0.95);
      spike.rotation.order = "YXZ"; // tilt outward first, then fan around the head
      spike.rotation.set(Math.PI - 0.35, a, i * -0.08);
      head.add(spike);
    }
    for (const side of [-1, 1]) {
      const lock = this.part(new ConeGeometry(0.17, 0.9, 10), hairMat, 0.05);
      lock.position.set(side * 0.9, -0.2, 0.28);
      lock.rotation.set(Math.PI, 0, side * -0.12);
      head.add(lock);
    }
    const ahoge = this.part(new TorusGeometry(0.22, 0.045, 8, 16, Math.PI * 1.3), hairMat, 0.08);
    ahoge.position.set(0.05, 1.12, 0.1);
    ahoge.rotation.set(0, Math.PI / 2, 0.4);
    head.add(ahoge);

    // Headphones (her grandmother's gift) with glowing cyan rings.
    const phonesMat = this.toon(PALETTE.headphones);
    const band = this.part(new TorusGeometry(1.13, 0.07, 10, 40, Math.PI), phonesMat);
    band.rotation.y = 0.12;
    head.add(band);
    for (const side of [-1, 1]) {
      const cup = this.part(new CylinderGeometry(0.34, 0.34, 0.26, 28), phonesMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 1.08, 0, -0.05);
      const glow = new MeshBasicMaterial({ color: new Color(PALETTE.trim) });
      this.glowMats.push(glow);
      const ring = new Mesh(new TorusGeometry(0.22, 0.045, 8, 28), glow);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = side * 1.22;
      head.add(cup, ring);
    }

    // Twin tails, tied just behind the headphones.
    for (const side of [-1, 1] as const) {
      const base = new Group();
      base.position.set(side * 1.0, 0.25, -0.35);
      head.add(base);
      const joints: Group[] = [];
      let parent: Group = base;
      const radii = [0.22, 0.21, 0.18, 0.13, 0.07];
      radii.forEach((r, i) => {
        const joint = new Group();
        if (i > 0) joint.position.y = -0.4;
        const color = i >= radii.length - 2 ? PALETTE.hairTip : PALETTE.hair;
        const seg = this.part(new CapsuleGeometry(r, 0.3, 6, 12), this.toon(color), 0.06);
        seg.position.y = -0.22;
        joint.add(seg);
        parent.add(joint);
        joints.push(joint);
        parent = joint;
      });
      const tie = this.part(new TorusGeometry(0.2, 0.07, 8, 20), this.toon(PALETTE.trim), 0);
      tie.rotation.x = Math.PI / 2;
      base.add(tie);
      this.tails.push({
        side,
        joints,
        springs: joints.map(() => ({ angle: 0, velocity: 0 })),
      });
    }
  }

  // ---------------------------------------------------------------- Avatar API

  setEmotion(emotion: Emotion) {
    // The painted face has no shy/love drawings: reuse happy/excited with a held blush.
    this.blushHold = emotion === "shy" || emotion === "love" ? 0.8 : 0;
    this.emotion = emotion === "shy" ? "happy" : emotion === "love" ? "excited" : emotion;
  }

  setMouth(open: number) {
    this.mouthTarget = Math.max(0, Math.min(1, open));
  }

  lookAt(x: number, y: number) {
    this.look.tx = x;
    this.look.ty = y;
  }

  play(gesture: Gesture) {
    this.gesture = { name: gesture, t: 0 };
    if (gesture === "poke") this.blush = 1;
  }

  setBusy(pose: BusyPose | null) {
    if (pose !== this.busy) this.busyT = 0;
    // Leaving the dive spin: drop whole turns so she doesn't unwind them all.
    if (this.busy === "dive" && pose !== "dive") {
      const y = this.body.rotation.y % (Math.PI * 2);
      this.body.rotation.y = y > Math.PI ? y - Math.PI * 2 : y;
    }
    this.busy = pose;
  }

  // ---------------------------------------------------------------- animation

  update(dt: number, t: number) {
    const ease = (k: number) => 1 - Math.exp(-k * dt);

    // Baseline: a floating data ghost, breathing and swaying.
    let y = 0.08 + Math.sin(t * 2) * 0.07;
    let squash = 1 + Math.sin(t * 2.4) * 0.012;
    let spinY = Math.sin(t * 0.7) * 0.08;
    let tiltZ = Math.sin(t * 1.1) * 0.03;
    let armL = { x: 0, z: 0.18 + Math.sin(t * 2) * 0.04 };
    let armR = { x: 0, z: -0.18 - Math.sin(t * 2) * 0.04 };
    let headX = -this.look.y * 0.22;
    let headY = this.look.x * 0.4;
    let headZ = Math.sin(t * 0.9) * 0.04;
    let glow = 0.55 + Math.sin(t * 3) * 0.1 + this.mouth * 0.4;

    this.look.x += (this.look.tx - this.look.x) * ease(6);
    this.look.y += (this.look.ty - this.look.y) * ease(6);

    // Looping busy poses.
    if (this.busy) {
      this.busyT += dt;
      const b = this.busyT;
      switch (this.busy) {
        case "think":
          armR = { x: -1.7, z: -0.55 };
          headZ = 0.18;
          headX = -0.15;
          glow = 0.5 + Math.sin(b * 4) * 0.25;
          break;
        case "listen":
          headZ = -0.14;
          glow = 0.8;
          break;
        case "typing":
          armL = { x: -1.15 + Math.sin(b * 28) * 0.12, z: 0.25 };
          armR = { x: -1.15 + Math.cos(b * 31) * 0.12, z: -0.25 };
          headX = 0.18;
          glow = 0.9;
          break;
        case "dive":
          // Diving into the network: spinning, glitching, headphones blazing.
          spinY = b * 5;
          tiltZ = 0.25;
          y += Math.sin(b * 9) * 0.05;
          armL = { x: 0, z: 2.4 };
          armR = { x: 0, z: -2.4 };
          glow = 1.5 + Math.sin(b * 20) * 0.5;
          this.root.position.x = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.18 : 0;
          break;
      }
    } else {
      this.root.position.x = 0;
    }

    // One-shot gestures override parts of the pose.
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const p = Math.min(1, g.t / GESTURE_SECONDS[g.name]);
      const hump = Math.sin(Math.PI * p);
      switch (g.name) {
        case "wave":
          armR = { x: 0, z: -2.5 + Math.sin(g.t * 14) * 0.35 * hump };
          headZ = 0.12 * hump;
          break;
        case "jump":
          y += hump * 0.7;
          squash = p < 0.15 || p > 0.85 ? 0.88 : 1.06;
          break;
        case "victory":
          y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.5;
          armL = { x: 0, z: 2.7 * Math.min(1, p * 4) };
          armR = { x: 0, z: -2.7 * Math.min(1, p * 4) };
          glow = 1.6;
          break;
        case "nod":
          headX += Math.sin(p * Math.PI * 4) * 0.22;
          break;
        case "shake":
          headY += Math.sin(p * Math.PI * 6) * 0.3 * hump;
          break;
        case "spin":
          spinY += p * Math.PI * 2;
          y += hump * 0.25;
          break;
        case "poke":
          squash = 1 - hump * 0.18;
          tiltZ += Math.sin(p * Math.PI * 5) * 0.12 * hump;
          break;
      }
      if (p >= 1) this.gesture = null;
    }

    // Apply pose with easing so everything moves softly.
    const k = ease(12);
    this.root.position.y = y;
    this.body.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
    this.body.rotation.y += (spinY - this.body.rotation.y) * (this.busy === "dive" ? 1 : k);
    this.body.rotation.z += (tiltZ - this.body.rotation.z) * k;
    this.armL.rotation.x += (armL.x - this.armL.rotation.x) * k;
    this.armL.rotation.z += (armL.z - this.armL.rotation.z) * k;
    this.armR.rotation.x += (armR.x - this.armR.rotation.x) * k;
    this.armR.rotation.z += (armR.z - this.armR.rotation.z) * k;
    this.headPivot.rotation.x += (headX - this.headPivot.rotation.x) * ease(8);
    this.headPivot.rotation.y += (headY - this.headPivot.rotation.y) * ease(8);
    this.headPivot.rotation.z += (headZ - this.headPivot.rotation.z) * ease(8);
    for (const m of this.glowMats) m.color.setRGB(0.37 * glow, 0.88 * glow, 1.0 * glow);

    this.updateTails(dt, t);
    this.updateFace(dt, t);
  }

  private updateTails(dt: number, t: number) {
    // Vertical velocity of the body drives the hair, so hops and bobs make it swing.
    const vy = (this.root.position.y - this.lastRootY) / Math.max(dt, 1e-3);
    const ay = (vy - this.rootVY) / Math.max(dt, 1e-3);
    this.lastRootY = this.root.position.y;
    this.rootVY = vy;
    const spin = this.body.rotation.y;
    const step = Math.min(dt, 1 / 30);

    for (const tail of this.tails) {
      tail.springs.forEach((s, i) => {
        const target =
          tail.side * (i === 0 ? 0.32 : 0.06) +
          Math.sin(t * 1.6 + i * 0.7) * 0.05 +
          tail.side * Math.max(-0.4, Math.min(0.4, ay * 0.004)) -
          this.headPivot.rotation.z * 0.6 +
          Math.sin(spin) * 0.15 * tail.side;
        const force = (target - s.angle) * 90 - s.velocity * 9;
        s.velocity += force * step;
        s.angle += s.velocity * step;
        tail.joints[i].rotation.z = s.angle;
        tail.joints[i].rotation.x = -0.12 - this.headPivot.rotation.x * 0.4;
      });
    }
  }

  private updateFace(dt: number, t: number) {
    const b = this.blink;
    if (t >= b.nextAt) {
      b.closingUntil = t + 0.13;
      b.nextAt = t + 1.8 + Math.random() * 3.5 + (Math.random() < 0.15 ? -1.6 : 0);
    }
    const target = t < b.closingUntil ? 1 : 0;
    b.value += (target - b.value) * (1 - Math.exp(-40 * dt));

    this.mouth += (this.mouthTarget - this.mouth) * (1 - Math.exp(-25 * dt));
    this.blush = Math.max(this.blushHold, this.blush - dt * 0.4);

    this.face.draw({
      emotion: this.emotion,
      blink: Math.round(b.value * 4) / 4,
      mouth: Math.round(this.mouth * 8) / 8,
      lookX: Math.round(this.look.x * 10) / 10,
      lookY: Math.round(this.look.y * 10) / 10,
      blush: Math.round(this.blush * 5) / 5,
    });
  }
}
