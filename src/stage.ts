import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { Avatar } from "./avatar/types";

const MAX_SPARKS = 48;

function sparkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 30 : 7;
    const a = (i / 8) * Math.PI * 2;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Transparent three.js stage: camera, lights, hologram base and sparkle bursts. */
export class Stage {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 0.1, 100);
  private readonly clock = new Clock();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly sparks: Points<BufferGeometry, PointsMaterial>;
  private readonly sparkVel = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkLife = new Float32Array(MAX_SPARKS);
  private ringBoost = 0;
  private readonly tickers: Array<(dt: number, t: number) => void> = [];

  constructor(
    canvas: HTMLCanvasElement,
    private avatar: Avatar,
  ) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.camera.position.set(0, 2.5, 12.5);
    this.camera.lookAt(0, 2.3, 0);

    this.scene.add(new HemisphereLight(0xffffff, 0x8ab4ff, 1.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 5, 6);
    this.scene.add(key);

    this.ring = new Mesh(
      new RingGeometry(0.75, 0.95, 48),
      new MeshBasicMaterial({
        color: 0x5fe1ff,
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = -0.12;
    this.scene.add(this.ring);

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparks = new Points(
      geo,
      new PointsMaterial({
        map: sparkTexture(),
        color: 0x9ff0ff,
        size: 0.32,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    this.scene.add(avatar.root);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setAvatar(avatar: Avatar) {
    this.scene.remove(this.avatar.root);
    this.avatar = avatar;
    this.scene.add(avatar.root);
  }

  onTick(fn: (dt: number, t: number) => void) {
    this.tickers.push(fn);
  }

  /** Spray sparkles from around ENE's head. */
  burst(count = 18) {
    const pos = this.sparks.geometry.attributes.position as BufferAttribute;
    let spawned = 0;
    for (let i = 0; i < MAX_SPARKS && spawned < count; i++) {
      if (this.sparkLife[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      pos.setXYZ(i, Math.cos(a) * 0.6, 2.4 + Math.random() * 0.6, Math.sin(a) * 0.4 + 0.5);
      this.sparkVel.set([Math.cos(a) * 2.2, 2 + Math.random() * 2, Math.sin(a) * 0.8], i * 3);
      this.sparkLife[i] = 0.9 + Math.random() * 0.5;
      spawned++;
    }
    this.ringBoost = 1;
  }

  /** Brighten the hologram base (used while ENE is busy working). */
  pulse(amount: number) {
    this.ringBoost = Math.max(this.ringBoost, amount);
  }

  start() {
    const loop = () => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      const t = this.clock.elapsedTime;
      for (const fn of this.tickers) fn(dt, t);
      this.avatar.update(dt, t);
      this.updateFx(dt, t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private updateFx(dt: number, t: number) {
    this.ringBoost = Math.max(0, this.ringBoost - dt * 0.8);
    const s = 1 + Math.sin(t * 2) * 0.04 + this.ringBoost * 0.25;
    this.ring.scale.set(s, s, s);
    this.ring.material.opacity = 0.35 + Math.sin(t * 3) * 0.08 + this.ringBoost * 0.5;
    this.ring.rotation.z = t * 0.4;

    const pos = this.sparks.geometry.attributes.position as BufferAttribute;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) {
        pos.setXYZ(i, 0, -100, 0);
        continue;
      }
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 5 * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.sparkVel[i * 3] * dt,
        pos.getY(i) + this.sparkVel[i * 3 + 1] * dt,
        pos.getZ(i) + this.sparkVel[i * 3 + 2] * dt,
      );
    }
    pos.needsUpdate = true;
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
