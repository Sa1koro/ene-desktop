import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { Group, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Emotion } from "../emotion";
import type { Avatar, BusyPose, Gesture } from "./types";

// Emotion -> weights of VRM 1.0 preset expressions.
const EXPRESSIONS: Record<Emotion, Partial<Record<string, number>>> = {
  neutral: {},
  happy: { happy: 0.9 },
  excited: { happy: 1, surprised: 0.3 },
  smug: { relaxed: 0.7, happy: 0.25 },
  angry: { angry: 0.85 },
  surprised: { surprised: 1 },
  sad: { sad: 0.85 },
  thinking: { relaxed: 0.35 },
  shy: { happy: 0.35, relaxed: 0.35 },
  love: { happy: 1, relaxed: 0.2 },
};
const PRESETS = ["happy", "angry", "sad", "relaxed", "surprised"];

const GESTURE_SECONDS: Record<Gesture, number> = {
  wave: 1.8,
  jump: 0.7,
  victory: 1.4,
  nod: 0.7,
  shake: 0.8,
  spin: 0.9,
  poke: 0.5,
};

/** Loads a VRM file (e.g. exported from VRoid Studio). */
export async function loadVrmAvatar(url: string): Promise<VrmAvatar> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  return new VrmAvatar(vrm);
}

/**
 * Same Avatar contract as the chibi: expressions through VRM presets, gestures
 * by posing normalized humanoid bones, spring bones handle hair physics.
 */
export class VrmAvatar implements Avatar {
  readonly root = new Group();
  private readonly lookTarget = new Object3D();
  private emotion: Emotion = "neutral";
  private weights: Record<string, number> = {};
  private mouthTarget = 0;
  private mouth = 0;
  private look = { x: 0, y: 0 };
  private blink = { value: 0, nextAt: 2, closingUntil: 0 };
  private gesture: { name: Gesture; t: number } | null = null;
  private busy: BusyPose | null = null;
  private busyT = 0;

  constructor(private readonly vrm: VRM) {
    this.root.add(vrm.scene);
    this.root.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    // Scale typical ~1.5m VRoid models to the chibi's ~3.4 unit stage height.
    this.root.scale.setScalar(2.2);
  }

  setEmotion(emotion: Emotion) {
    this.emotion = emotion;
  }
  setMouth(open: number) {
    this.mouthTarget = Math.max(0, Math.min(1, open));
  }
  lookAt(x: number, y: number) {
    this.look = { x, y };
  }
  play(gesture: Gesture) {
    this.gesture = { name: gesture, t: 0 };
  }
  setBusy(pose: BusyPose | null) {
    if (pose !== this.busy) this.busyT = 0;
    // Leaving the dive spin: drop whole turns so she doesn't unwind them all.
    if (this.busy === "dive" && pose !== "dive") {
      const y = this.root.rotation.y % (Math.PI * 2);
      this.root.rotation.y = y > Math.PI ? y - Math.PI * 2 : y;
    }
    this.busy = pose;
  }

  private bone(name: Parameters<NonNullable<VRM["humanoid"]>["getNormalizedBoneNode"]>[0]) {
    return this.vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  update(dt: number, t: number) {
    const ease = (k: number) => 1 - Math.exp(-k * dt);
    const em = this.vrm.expressionManager;

    // Expressions, cross-faded.
    const target = EXPRESSIONS[this.emotion];
    for (const name of PRESETS) {
      const w = this.weights[name] ?? 0;
      this.weights[name] = w + ((target[name] ?? 0) - w) * ease(8);
      em?.setValue(name, this.weights[name]);
    }
    this.mouth += (this.mouthTarget - this.mouth) * ease(25);
    em?.setValue("aa", this.mouth * 0.8);
    const b = this.blink;
    if (t >= b.nextAt) {
      b.closingUntil = t + 0.13;
      b.nextAt = t + 1.8 + Math.random() * 3.5;
    }
    b.value += ((t < b.closingUntil ? 1 : 0) - b.value) * ease(40);
    // Blinking fights the "happy" closed-eye preset, so fade it out there.
    em?.setValue("blink", b.value * (1 - (this.weights.happy ?? 0)));

    this.lookTarget.position.set(this.look.x * 2, 3 + this.look.y * 1.2, 4);

    // Pose: arms down from T-pose, gentle float.
    let y = Math.sin(t * 2) * 0.03;
    let spinY = Math.sin(t * 0.7) * 0.08;
    let lArm = -1.2;
    let rArm = 1.2;
    let headX = 0;
    let headZ = Math.sin(t * 0.9) * 0.04;

    if (this.busy) {
      this.busyT += dt;
      if (this.busy === "dive") {
        spinY = this.busyT * 5;
        lArm = 1.1;
        rArm = -1.1;
      } else if (this.busy === "think") {
        headZ = 0.15;
        rArm = 0.6;
      } else if (this.busy === "typing") {
        headX = 0.2;
      } else if (this.busy === "listen") {
        headZ = -0.12;
      }
    }
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const p = Math.min(1, g.t / GESTURE_SECONDS[g.name]);
      const hump = Math.sin(Math.PI * p);
      if (g.name === "wave") rArm = -1.3 + Math.sin(g.t * 14) * 0.3 * hump;
      if (g.name === "victory") [lArm, rArm] = [1.2, -1.2];
      if (g.name === "jump" || g.name === "victory") y += hump * 0.25;
      if (g.name === "spin") spinY += p * Math.PI * 2;
      if (g.name === "nod") headX += Math.sin(p * Math.PI * 4) * 0.2;
      if (g.name === "shake") headZ += Math.sin(p * Math.PI * 6) * 0.2 * hump;
      if (p >= 1) this.gesture = null;
    }

    const k = ease(10);
    this.root.position.y = y;
    this.root.rotation.y += (spinY - this.root.rotation.y) * (this.busy === "dive" ? 1 : k);
    const lUpper = this.bone("leftUpperArm");
    const rUpper = this.bone("rightUpperArm");
    const head = this.bone("head");
    if (lUpper) lUpper.rotation.z += (lArm - lUpper.rotation.z) * k;
    if (rUpper) rUpper.rotation.z += (rArm - rUpper.rotation.z) * k;
    if (head) {
      head.rotation.x += (headX - head.rotation.x) * k;
      head.rotation.z += (headZ - head.rotation.z) * k;
    }

    this.vrm.update(dt);
  }
}
