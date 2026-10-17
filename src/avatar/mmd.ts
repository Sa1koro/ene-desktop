import { buildAnimation, MMDLoader, VMDLoader, type MMD, type VmdObject } from "@moeru/three-mmd";
import { MMDAmmoPlugin } from "@moeru/three-mmd-physics-ammo";
import {
  AnimationMixer,
  Bone,
  Euler,
  Group,
  LoopOnce,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Material,
} from "three";
import { motions } from "virtual:models";
import type { Emotion } from "../emotion";
import type { Avatar, BusyPose, Gesture } from "./types";

// ---------------------------------------------------------------- expressions

type Morphs = Record<string, number>;

// Each mood has a few looks built from the model's own morphs (standard MMD names,
// as shipped in YYB式ENE). One is picked whenever the mood changes, so ENE doesn't
// pull the exact same face every time.
const LOOKS: Record<Emotion, Morphs[]> = {
  neutral: [{ 口角上げ: 0.25 }, { にっこり: 0.2, 瞳大: 0.15 }],
  happy: [
    { 笑い: 1, にこり: 0.8, にっこり: 0.8 },
    { にこり: 0.7, ワ: 0.55, 口角上げ: 0.4, 瞳大: 0.2 },
    { 笑い: 1, にこり: 0.6, ω: 0.8 },
  ],
  excited: [
    { 星目: 1, にこり: 0.7, ワ: 0.8, 照れ: 0.3 },
    { はぅ: 1, にこり: 0.6, ワ: 1, 照れ: 0.4 },
  ],
  smug: [
    { じと目: 0.45, にやり: 1, にこり: 0.3 },
    { ウィンク右: 1, ぺろっ: 1, にこり: 0.6 },
    { なごみ: 0.6, ω: 1, 上: 0.3 },
  ],
  angry: [
    { 怒り: 1, じと目: 0.3, "∧": 0.8, 口角下げ: 0.4, 左怒り: 1 },
    { 怒り: 1, "▲": 0.7, 瞳小: 0.3, 照れ: 0.5 },
  ],
  surprised: [
    { びっくり: 1, 瞳小: 0.5, 上: 0.8, "□": 0.7, "左△△△": 1, "右△△△": 1 },
    { "なぬ！": 1, 上: 0.6, "▲": 0.6, "左！": 1, "右！": 1 },
  ],
  sad: [
    { 困る: 1, たれ目: 0.4, 口角下げ: 0.6, 涙: 0.8 },
    { 困る: 1, じと目: 0.25, "∧": 0.6, 右汗: 1 },
  ],
  thinking: [
    { 真面目: 0.4, 右上: 0.6, じと目: 0.15, "∧": 0.4 },
    { 困る: 0.3, 左上: 0.5, う: 0.3 },
  ],
  shy: [
    { 照れ2: 1, 困る: 0.6, たれ目: 0.3, ω: 0.4 },
    { 照れ3: 1, はぅ: 0.8, 困る: 0.5, "∧": 0.4 },
  ],
  love: [{ はぁと: 1, 照れ2: 0.8, にこり: 0.7, ワ: 0.5 }],
};

// How much a morph already closes the eyes (blinking on top looks broken).
const EYE_CLOSURE: Morphs = {
  笑い: 1,
  はぅ: 1,
  ｷﾞｭｯ: 1,
  なごみ: 0.8,
  じと目: 0.5,
  ウィンク右: 0.5,
  ウィンク左: 0.5,
};

const VOWEL_MORPHS = { a: "あ", i: "い", u: "う", e: "え", o: "お" } as const;
type Vowel = keyof typeof VOWEL_MORPHS;
const VOWEL_GAIN: Record<Vowel, number> = { a: 1, i: 0.65, u: 0.75, e: 0.8, o: 0.9 };

const KANA: Record<Vowel, string> = {
  a: "あかさたなはまやらわがざだばぱぁゃアカサタナハマヤラワガザダバパァャ",
  i: "いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィ",
  u: "うくすつぬふむゆるぐずづぶぷぅゅウクスツヌフムユルグズヅブプゥュ",
  e: "えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ",
  o: "おこそとのほもよろをごぞどぼぽぉょオコソトノホモヨロヲゴゾドボポォョ",
};
const KANA_VOWEL = new Map<string, Vowel>();
for (const [v, chars] of Object.entries(KANA) as Array<[Vowel, string]>)
  for (const ch of chars) KANA_VOWEL.set(ch, v);
// Hanzi carry no vowel we can read cheaply; a stable pseudo-random pick still
// gives the mouth varied shapes instead of one flapping "a".
const HANZI_VOWELS: Vowel[] = ["a", "a", "i", "u", "e", "o", "a", "o"];

function vowelOf(ch: string, previous: Vowel): Vowel {
  const kana = KANA_VOWEL.get(ch);
  if (kana) return kana;
  const lower = ch.toLowerCase();
  if ("aeiou".includes(lower) && lower) return lower as Vowel;
  if (/[a-z]/.test(lower)) return previous;
  const code = ch.codePointAt(0) ?? 0;
  return code > 0x2e80 ? HANZI_VOWELS[code % HANZI_VOWELS.length] : previous;
}

// ---------------------------------------------------------------- body poses

type V3 = [number, number, number];
/** Curl per finger in radians: thumb, index, middle, ring, little. */
type Fingers = [number, number, number, number, number];
/**
 * An arm pose as directions in chest space, written for ENE's left arm (+X).
 * The right arm uses the mirror image.
 */
type Arm = { upper: V3; fore: V3; fingers: Fingers };

const RELAXED: Fingers = [0.2, 0.25, 0.3, 0.35, 0.4];
const OPEN: Fingers = [0, 0, 0, 0.05, 0.1];
const FIST: Fingers = [0.7, 1.3, 1.4, 1.4, 1.4];
const VSIGN: Fingers = [0.8, 0, 0, 1.4, 1.4];

const ARMS = {
  down: { upper: [0.28, -1, 0.06], fore: [0.12, -1, 0.22], fingers: RELAXED },
  hip: { upper: [0.8, -0.6, -0.15], fore: [-0.75, -0.55, 0.2], fingers: [0.3, 0.6, 0.6, 0.6, 0.6] },
  clasp: { upper: [0.18, -0.92, 0.32], fore: [-0.64, -0.7, 0.33], fingers: [0.4, 0.6, 0.6, 0.6, 0.6] },
  heart: { upper: [0.3, -0.9, 0.4], fore: [-0.6, 0.4, 0.7], fingers: [0.4, 0.8, 0.8, 0.8, 0.8] },
  chin: { upper: [0.25, -0.85, 0.55], fore: [-0.5, 0.72, 0.45], fingers: [0.3, 0.2, 0.9, 1.1, 1.2] },
  across: { upper: [0.2, -1, 0.3], fore: [-0.8, 0.1, 0.6], fingers: RELAXED },
  startled: { upper: [0.55, -0.7, 0.4], fore: [0.05, 1, 0.35], fingers: OPEN },
  fists: { upper: [0.5, -0.8, 0.35], fore: [-0.1, 0.9, 0.5], fingers: FIST },
  cheer: { upper: [0.4, 1, 0.15], fore: [0.1, 1, 0.1], fingers: OPEN },
  wave: { upper: [1, 0.3, 0.15], fore: [0.1, 1, 0.15], fingers: OPEN },
  vsign: { upper: [0.85, -0.2, 0.45], fore: [-0.35, 1, 0.25], fingers: VSIGN },
  keys: { upper: [0.25, -1, 0.3], fore: [-0.2, -0.15, 1], fingers: [0.3, 0.35, 0.35, 0.35, 0.35] },
  dive: { upper: [0.2, 0.55, 1], fore: [0.02, 0.6, 1], fingers: OPEN },
  ear: { upper: [0.75, -0.35, 0.45], fore: [-0.45, 0.88, 0.1], fingers: [0.2, 0.1, 0.15, 0.2, 0.25] },
  out: { upper: [1, -0.35, 0.1], fore: [1, -0.2, 0.15], fingers: OPEN },
} satisfies Record<string, Arm>;

/** Whole-body target. Rotations are Euler XYZ in radians (+X nods forward). */
type Body = {
  l: Arm;
  r: Arm;
  center: V3; // センター offset in model units (-y crouches; leg IK bends the knees)
  hips: V3;
  chest: V3;
  neck: V3;
  head: V3;
  shrug: number; // + lifts both shoulders
};

const still = (): Body => ({
  l: ARMS.down,
  r: ARMS.down,
  center: [0, 0, 0],
  hips: [0, 0, 0],
  chest: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  shrug: 0,
});

// Body language per mood, layered on breathing and sway.
const MOOD_BODY: Record<Emotion, (t: number) => Partial<Body>> = {
  neutral: () => ({}),
  happy: (t) => ({ center: [0, Math.abs(Math.sin(t * 3)) * 0.12, 0], head: [0, 0, 0.1] }),
  excited: (t) => ({ l: ARMS.fists, r: ARMS.fists, center: [0, Math.abs(Math.sin(t * 5)) * 0.3, 0] }),
  smug: () => ({ l: ARMS.hip, head: [0.05, 0, -0.12], chest: [0, 0.12, 0.04] }),
  angry: () => ({ l: ARMS.hip, r: ARMS.hip, chest: [0.1, 0, 0], head: [0.12, 0, 0] }),
  surprised: () => ({ l: ARMS.startled, r: ARMS.startled, chest: [-0.12, 0, 0], head: [-0.1, 0, 0], shrug: 0.3 }),
  sad: () => ({ chest: [0.12, 0, 0], head: [0.28, 0, 0.06], shrug: -0.15 }),
  thinking: () => ({ r: ARMS.chin, l: ARMS.across, head: [-0.05, 0.15, 0.15] }),
  shy: (t) => ({ l: ARMS.clasp, r: ARMS.clasp, head: [0.22, 0, 0.12], chest: [0.06, Math.sin(t * 1.4) * 0.08, 0] }),
  love: (t) => ({ l: ARMS.heart, r: ARMS.heart, head: [0.05, 0, 0.15 + Math.sin(t * 1.6) * 0.05] }),
};

const BUSY_BODY: Record<BusyPose, (t: number) => Partial<Body>> = {
  think: () => ({ r: ARMS.chin, l: ARMS.across, head: [-0.08, 0.15, 0.15] }),
  dive: () => ({ l: ARMS.dive, r: ARMS.dive, chest: [0.3, 0, 0], head: [-0.25, 0, 0] }),
  typing: (t) => ({
    l: { ...ARMS.keys, fore: [-0.2, -0.15 + Math.sin(t * 21) * 0.1, 1] },
    r: { ...ARMS.keys, fore: [-0.2, -0.15 + Math.sin(t * 23 + 1.3) * 0.1, 1] },
    chest: [0.08, 0, 0],
    head: [0.25, 0, 0],
  }),
  listen: () => ({ r: ARMS.ear, head: [0.05, -0.15, 0.15], chest: [0.06, 0, 0] }),
};

type GestureFx = { body: Body; morphs?: Morphs; hop?: number; spin?: number };

const GESTURE_SECONDS: Record<Gesture, number> = {
  wave: 1.8,
  jump: 0.8,
  victory: 1.6,
  nod: 0.7,
  shake: 0.8,
  spin: 1.1,
  poke: 0.6,
};

// One-shot gestures, each given the pose it interrupts and its progress 0..1.
const GESTURES: Record<Gesture, (base: Body, p: number, t: number) => GestureFx> = {
  wave: (b, _p, t) => ({
    body: { ...b, r: { ...ARMS.wave, fore: [0.1 + Math.sin(t * 12) * 0.45, 1, 0.15] }, head: add(b.head, [0, 0, -0.1]) },
    // 袖小 shrinks ENE's huge sleeves so the open hand (or the V) actually shows.
    morphs: { にっこり: 0.6, 袖小: 1 },
  }),
  victory: (b, p) => ({
    body: { ...b, r: ARMS.vsign, l: ARMS.hip, head: add(b.head, [0, 0.1, 0.15]), chest: add(b.chest, [0, -0.15, 0]) },
    morphs: { ウィンク右: 1, にっこり: 0.8, にこり: 0.6, 袖小: 1 },
    hop: Math.sin(Math.PI * Math.min(1, p * 2.5)) * 0.25,
  }),
  jump: (b, p) => ({
    // Crouch first (IK bends the knees), then the whole body leaves the ground.
    body: { ...b, l: ARMS.out, r: ARMS.out, center: [0, p < 0.3 ? -1.2 * Math.sin((p / 0.3) * Math.PI) : 0, 0] },
    hop: p < 0.3 ? 0 : Math.sin(((p - 0.3) / 0.7) * Math.PI) * 0.45,
  }),
  nod: (b, p) => ({ body: { ...b, head: add(b.head, [Math.sin(p * Math.PI * 4) * 0.22, 0, 0]) } }),
  shake: (b, p) => ({
    body: { ...b, head: add(b.head, [0, Math.sin(p * Math.PI * 6) * 0.3 * Math.sin(Math.PI * p), 0]) },
  }),
  spin: (b, p) => ({ body: { ...b, l: ARMS.out, r: ARMS.out }, spin: easeInOut(p) * Math.PI * 2 }),
  poke: (b) => ({
    body: {
      ...b,
      l: ARMS.startled,
      r: ARMS.startled,
      chest: add(b.chest, [-0.2, 0, 0]),
      head: add(b.head, [-0.1, 0, 0.15]),
      shrug: 0.5,
    },
    morphs: { ｷﾞｭｯ: 1, "▲": 0.6 },
  }),
};

const BONES = {
  center: "センター",
  hips: "下半身",
  chest: "上半身",
  chest2: "上半身2",
  neck: "首",
  head: "頭",
  eyes: "両目",
} as const;
const FINGER_NAMES = [
  ["親指０", "親指１", "親指２"],
  ["人指１", "人指２", "人指３"],
  ["中指１", "中指２", "中指３"],
  ["薬指１", "薬指２", "薬指３"],
  ["小指１", "小指２", "小指３"],
];

// ---------------------------------------------------------------- VMD motions

// Optional hand-animated motions from the MMD community, dropped into
// public/models/motions/: idle.vmd loops in place of the neutral standing pose and
// <gesture>.vmd (wave.vmd, victory.vmd, ...) replaces that procedural gesture. Bones
// a clip doesn't key stay procedural, and the face never comes from the VMD.
const MOTION_DIR = "/models/motions/";
type MotionName = Gesture | "idle";

/**
 * One playing VMD clip. Its mixer writes into stand-in bones rather than the model's
 * (a mixer only writes values that changed, which would leave last frame's blend in
 * place), and each frame's sample is then blended onto the real bones by `weight`.
 */
type Layer = { mixer: AnimationMixer; bones: Bone[]; rig: Bone[]; weight: number };
type Move = Layer & { name: Gesture; t: number; length: number; leaving: boolean };

/** Loads a PMX model (MMD) with Ammo.js rigid-body physics for hair and skirt. */
export async function loadMmdAvatar(url: string): Promise<MmdAvatar> {
  const mmd = await new MMDLoader().register(MMDAmmoPlugin).loadAsync(url);
  return new MmdAvatar(mmd);
}

type ArmRig = {
  side: 1 | -1;
  shoulder: Bone;
  arm: Bone;
  elbow: Bone;
  restUpper: Vector3;
  restFore: Vector3;
  fingers: Bone[][];
  curlAxis: Vector3;
  thumbAxis: Vector3;
};

/**
 * Full-body MMD ENE: the model's ~100 facial morphs drive mood looks, vowel lip
 * sync, blinks and effects; arms, spine and head are posed procedurally; leg IK
 * keeps the feet planted, and the model's own rigid bodies swing hair and skirt.
 */
export class MmdAvatar implements Avatar {
  readonly root = new Group();
  readonly outlined = true;
  // Toon ramps want a strong key light; flat ambient washes the colors out.
  readonly lighting = { ambient: 0.55, key: 2.4 };

  private readonly morphIndex = new Map<string, number>();
  private readonly morphNow = new Map<string, number>();
  private readonly bone = new Map<string, Bone>();
  private readonly arms: ArmRig[];
  private readonly centerRest: Vector3;
  private readonly targets = new Map<Bone, Quaternion>();
  private readonly rest = new Map<Bone, { position: Vector3; quaternion: Quaternion }>();
  private first = true;

  private emotion: Emotion = "neutral";
  private look: Morphs = LOOKS.neutral[0];
  private mouthTarget = 0;
  private mouth = 0;
  private talk = 0;
  private vowel: Vowel = "a";
  private gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  private blink = { value: 0, nextAt: 2, closingUntil: 0 };
  private blush = 0;
  private gesture: { name: Gesture; t: number } | null = null;
  private busy: BusyPose | null = null;
  private busyT = 0;
  private spinY = 0;
  private center = new Vector3();
  private readonly clips = new Map<Gesture, AnimationClip>();
  private idle: Layer | null = null;
  private idleOn = 0;
  private moves: Move[] = [];

  constructor(private readonly mmd: MMD) {
    const mesh = mmd.mesh;
    this.root.add(mesh);
    // Model units are ~decimeters (ENE is ~20 tall); the stage expects ~3.6.
    mmd.setScalar(0.175);

    for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {}))
      this.morphIndex.set(name, index);
    for (const b of mesh.skeleton.bones) {
      if (!this.bone.has(b.name)) this.bone.set(b.name, b);
      this.rest.set(b, { position: b.position.clone(), quaternion: b.quaternion.clone() });
    }

    const rest = (name: string) => {
      const i = mmd.pmx.bones.findIndex((b) => b.name === name);
      const p = mmd.pmx.bones[i]?.position ?? [0, 0, 0];
      return new Vector3(p[0], p[1], p[2]);
    };
    this.centerRest = this.need(BONES.center).position.clone();
    this.arms = ([1, -1] as const).map((side) => {
      const s = side === 1 ? "左" : "右";
      const restFore = rest(`${s}手首`).sub(rest(`${s}ひじ`)).normalize();
      return {
        side,
        shoulder: this.need(`${s}肩`),
        arm: this.need(`${s}腕`),
        elbow: this.need(`${s}ひじ`),
        restUpper: rest(`${s}ひじ`).sub(rest(`${s}腕`)).normalize(),
        restFore,
        fingers: FINGER_NAMES.map((joints) => joints.map((j) => this.bone.get(s + j)).filter((b) => !!b)),
        // Fingers curl toward the palm (down, then inward); the thumb folds across it.
        curlAxis: new Vector3(0, 0, -side),
        thumbAxis: restFore.clone().multiplyScalar(-1),
      };
    });

    // MMD edges: PMX flag 0x10 marks materials that draw an outline.
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((m: Material, i) => {
      const pm = mmd.pmx.materials[i];
      if (!pm) return;
      m.userData.outlineParameters = {
        thickness: pm.edgeSize / 300,
        color: pm.edgeColor.slice(0, 3),
        alpha: pm.edgeColor[3],
        visible: (pm.flag & 0x10) !== 0 && pm.edgeSize > 0,
      };
    });

    void this.loadMotions();
  }

  private need(name: string): Bone {
    const b = this.bone.get(name);
    if (!b) throw new Error(`MMD model has no bone "${name}"`);
    return b;
  }

  /** Fetches whichever VMD motions exist, in the background; until then (or without them) poses stay procedural. */
  private async loadMotions() {
    const names: MotionName[] = ["idle", ...(Object.keys(GESTURE_SECONDS) as Gesture[])];
    await Promise.all(
      // The motions present when the app was built (see scripts/models.mjs).
      names.filter((name) => motions.includes(`${name}.vmd`)).map(async (name) => {
        const url = `${MOTION_DIR}${name}.vmd`;
        try {
          const clip = this.buildClip(await new VMDLoader().loadAsync(url));
          if (clip.tracks.length === 0) throw new Error("it animates none of this model's bones");
          clip.name = name;
          if (name === "idle") this.idle = this.layer(clip, true);
          else this.clips.set(name, clip);
        } catch (err) {
          console.warn(`Skipping VMD motion ${url}`, err);
        }
      }),
    );
  }

  /** A clip of the VMD's bone tracks; its morph tracks are dropped so expressions and lip sync stay ours. */
  private buildClip(vmd: VmdObject): AnimationClip {
    // buildAnimation offsets position keys from each bone's current position: use rest.
    const bones = this.mmd.mesh.skeleton.bones;
    const posed = bones.map((b) => b.position.clone());
    for (const b of bones) b.position.copy(this.rest.get(b)!.position);
    const clip = buildAnimation(vmd, this.mmd.mesh);
    bones.forEach((b, i) => b.position.copy(posed[i]));
    clip.tracks = clip.tracks.filter((track) => track.name.startsWith(".bones["));
    return clip;
  }

  private layer(clip: AnimationClip, loop: boolean): Layer {
    const names = new Set(clip.tracks.map((track) => /^\.bones\[(.+)\]\./.exec(track.name)?.[1] ?? ""));
    const bones = [...names].map((name) => this.bone.get(name)).filter((b) => !!b);
    const rig = bones.map((b) => Object.assign(new Bone(), { name: b.name }));
    const mixer = new AnimationMixer(Object.assign(new Object3D(), { skeleton: { bones: rig } }));
    const action = mixer.clipAction(clip);
    // A single-keyframe VMD has no length to loop over; it just holds its pose.
    if (!loop || clip.duration === 0) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    return { mixer, bones, rig, weight: 0 };
  }

  // ---------------------------------------------------------------- Avatar API

  setEmotion(emotion: Emotion) {
    if (emotion === this.emotion) return;
    this.emotion = emotion;
    this.look = pick(LOOKS[emotion]);
  }
  setMouth(open: number, char?: string) {
    this.mouthTarget = Math.max(0, Math.min(1, open));
    if (char && open > 0) this.vowel = vowelOf(char, this.vowel);
  }
  lookAt(x: number, y: number) {
    this.gaze.tx = x;
    this.gaze.ty = y;
  }
  play(gesture: Gesture) {
    // A VMD gesture still playing fades out under whatever comes next.
    for (const move of this.moves) move.leaving = true;
    const clip = this.clips.get(gesture);
    if (clip) {
      this.gesture = null;
      const length = clip.duration || GESTURE_SECONDS[gesture];
      this.moves.push({ ...this.layer(clip, false), name: gesture, t: 0, length, leaving: false });
    } else this.gesture = { name: gesture, t: 0 };
    if (gesture === "poke") this.blush = 1;
  }
  setBusy(pose: BusyPose | null) {
    if (pose !== this.busy) this.busyT = 0;
    // Leaving the dive spin: drop whole turns so she doesn't unwind them all.
    if (this.busy === "dive" && pose !== "dive") {
      const y = this.spinY % (Math.PI * 2);
      this.spinY = y > Math.PI ? y - Math.PI * 2 : y;
    }
    this.busy = pose;
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, t: number) {
    const ease = (k: number) => (this.first ? 1 : 1 - Math.exp(-k * dt));
    this.mmd.beforeUpdate();

    // Body: mood (or busy pose) → gesture overlay → breathing, sway, gaze.
    let body: Body = { ...still(), ...MOOD_BODY[this.emotion](t) };
    if (this.busy) {
      this.busyT += dt;
      body = { ...body, ...BUSY_BODY[this.busy](t) };
    }
    let gestureMorphs: Morphs = {};
    let gestureWeight = 0;
    let hop = 0;
    let spin = 0;
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const p = Math.min(1, g.t / GESTURE_SECONDS[g.name]);
      const fx = GESTURES[g.name](body, p, g.t);
      // Ease in over the first 15% and out over the last 20%.
      const w = Math.min(1, p / 0.15, (1 - p) / 0.2);
      body = blendBody(body, fx.body, w);
      for (const [k, v] of Object.entries(fx.morphs ?? {})) gestureMorphs[k] = v * w;
      gestureWeight = w;
      hop = fx.hop ?? 0;
      spin = fx.spin ?? 0;
      if (p >= 1) this.gesture = null;
    }

    const breathe = Math.sin(t * 2.1);
    body.chest = add(body.chest, [breathe * 0.015, 0, Math.sin(t * 0.9) * 0.03]);
    body.hips = add(body.hips, [0, 0, -Math.sin(t * 0.9) * 0.025]);
    body.shrug += breathe * 0.02;

    const g = this.gaze;
    g.x += (g.tx - g.x) * ease(6);
    g.y += (g.ty - g.y) * ease(6);
    const turn = gazeTurn(g.x, g.y);
    body.neck = add(body.neck, turn.neck);
    body.head = add(body.head, turn.head);
    body.chest = add(body.chest, turn.chest);

    this.poseBody(body, ease(12));
    this.playMotions(dt, ease, body, gestureWeight, gestureMorphs);

    // Root: hologram float, gesture hops, spins.
    if (this.busy === "dive") this.spinY += dt * 3;
    else this.spinY += (Math.sin(t * 0.7) * 0.08 - this.spinY) * ease(6);
    this.root.position.y = 0.05 + Math.sin(t * 2) * 0.04 + hop;
    this.root.rotation.y = this.spinY + spin;

    this.updateFace(dt, t, gestureMorphs, ease);

    this.root.updateMatrixWorld(true);
    if (this.first) {
      // Start the rigid bodies from the posed body, not the A-pose.
      this.mmd.physics?.reset?.();
      this.first = false;
    }
    this.mmd.update(dt);
  }

  private poseBody(body: Body, k: number) {
    const q = new Quaternion();
    const euler = new Euler();
    const set = (b: Bone | undefined, target: Quaternion) => {
      if (!b) return;
      let cur = this.targets.get(b);
      if (!cur) this.targets.set(b, (cur = b.quaternion.clone()));
      cur.slerp(target, k);
      b.quaternion.copy(cur);
    };
    const rot = (name: string, r: V3) => set(this.bone.get(name), q.setFromEuler(euler.set(r[0], r[1], r[2])));

    // Split spine/neck rotations across the chain so bends look organic.
    rot(BONES.hips, body.hips);
    rot(BONES.chest, scale(body.chest, 0.6));
    rot(BONES.chest2, scale(body.chest, 0.4));
    rot(BONES.neck, body.neck);
    rot(BONES.head, body.head);
    rot(BONES.eyes, gazeTurn(this.gaze.x, this.gaze.y).eyes);

    this.center.lerp(new Vector3(...body.center), k);
    this.need(BONES.center).position.copy(this.centerRest).add(this.center);

    for (const rig of this.arms) {
      const arm = rig.side === 1 ? body.l : body.r;
      rot(rig.shoulder.name, [0, 0, body.shrug * 0.35 * rig.side]);

      // Point the upper arm, then the forearm, at the pose directions.
      const upper = mirror(arm.upper, rig.side);
      const fore = mirror(arm.fore, rig.side);
      const qArm = new Quaternion().setFromUnitVectors(rig.restUpper, upper);
      set(rig.arm, qArm);
      const local = fore.applyQuaternion(qArm.clone().invert());
      set(rig.elbow, new Quaternion().setFromUnitVectors(rig.restFore, local));

      rig.fingers.forEach((joints, f) => {
        const axis = f === 0 ? rig.thumbAxis : rig.curlAxis;
        const curl = arm.fingers[f] * (f === 0 ? 0.6 : 1);
        for (const j of joints) set(j, new Quaternion().setFromAxisAngle(axis, curl));
      });
    }
  }

  /**
   * Blends VMD clips over the procedural pose: idle.vmd while ENE stands around in a
   * neutral mood, VMD gestures on top. Every bone a clip keys starts from its
   * procedural pose, or from rest where the procedural rig doesn't reach.
   */
  private playMotions(dt: number, ease: (k: number) => number, body: Body, gestureWeight: number, gestureMorphs: Morphs) {
    const layers: Layer[] = [];
    if (this.idle) {
      const on = this.emotion === "neutral" && !this.busy ? 1 : 0;
      this.idleOn += (on - this.idleOn) * ease(3);
      if (Math.abs(on - this.idleOn) < 0.001) this.idleOn = on;
      // A procedural gesture needs the body back, so idle steps aside while it plays.
      this.idle.weight = this.idleOn * (1 - gestureWeight);
      layers.push(this.idle);
    }
    for (const move of this.moves) {
      move.t += dt;
      if (move.leaving) move.weight = Math.max(0, move.weight - dt / 0.3);
      else {
        const fadeIn = Math.min(0.3, move.length * 0.25);
        const fadeOut = Math.min(0.4, move.length * 0.3);
        move.weight = easeInOut(Math.max(0, Math.min(1, move.t / fadeIn, (move.length - move.t) / fadeOut)));
      }
      // The procedural gesture's face (and 袖小, so the hands show) comes along.
      const fx = GESTURES[move.name](body, Math.min(1, move.t / move.length), move.t);
      for (const [k, v] of Object.entries(fx.morphs ?? {}))
        gestureMorphs[k] = Math.max(gestureMorphs[k] ?? 0, v * move.weight);
      layers.push(move);
    }

    const center = this.need(BONES.center);
    for (const layer of layers)
      for (const b of layer.bones) {
        const rest = this.rest.get(b)!;
        if (!this.targets.has(b)) b.quaternion.copy(rest.quaternion);
        if (b !== center) b.position.copy(rest.position);
      }
    const reach = new Map<Bone, number>(); // share of each bone's pose that comes from VMD
    for (const layer of layers) {
      if (layer.weight <= 0) continue;
      layer.mixer.update(dt);
      layer.bones.forEach((b, i) => {
        b.quaternion.slerp(layer.rig[i].quaternion, layer.weight);
        b.position.lerp(layer.rig[i].position, layer.weight);
        reach.set(b, 1 - (1 - (reach.get(b) ?? 0)) * (1 - layer.weight));
      });
    }

    // The motion's head knows nothing of the pointer: turn it back toward the gaze.
    const turn = gazeTurn(this.gaze.x, this.gaze.y);
    const q = new Quaternion();
    const euler = new Euler();
    const looks: Array<[string, V3]> = [
      [BONES.chest, scale(turn.chest, 0.6)],
      [BONES.chest2, scale(turn.chest, 0.4)],
      [BONES.neck, turn.neck],
      [BONES.head, turn.head],
      [BONES.eyes, turn.eyes],
    ];
    for (const [name, r] of looks) {
      const b = this.bone.get(name);
      const w = b ? reach.get(b) : undefined;
      if (b && w) b.quaternion.multiply(q.setFromEuler(euler.set(r[0] * w, r[1] * w, r[2] * w)));
    }

    this.moves = this.moves.filter((m) => m.weight > 0 || (!m.leaving && m.t < m.length));
    // VMD property frames can switch IK chains (say, leg IK) off; the clip in charge
    // decides, and the model's own settings return once no clip is.
    const lead = [...layers].reverse().find((l) => l.weight >= 0.5);
    this.mmd.updateAnimation(lead?.mixer);
  }

  private updateFace(dt: number, t: number, gestureMorphs: Morphs, ease: (k: number) => number) {
    const target: Morphs = {};
    const put = (name: string, w: number) => (target[name] = Math.max(target[name] ?? 0, w));

    // Speech wins over mood mouth shapes; the vowel follows the spoken character.
    this.mouth += (this.mouthTarget - this.mouth) * ease(25);
    this.talk += ((this.mouthTarget > 0.05 ? 1 : 0) - this.talk) * ease(6);
    const mouthPanel = (name: string) => this.mmd.pmx.morphs[this.morphIndex.get(name) ?? -1]?.category === 3;
    for (const [name, w] of Object.entries(this.look)) put(name, mouthPanel(name) ? w * (1 - 0.8 * this.talk) : w);
    for (const [name, w] of Object.entries(gestureMorphs)) put(name, w);
    put(VOWEL_MORPHS[this.vowel], this.mouth * VOWEL_GAIN[this.vowel]);

    this.blush = Math.max(0, this.blush - dt * 0.4);
    put("照れ2", this.blush * 0.9);

    const b = this.blink;
    if (t >= b.nextAt) {
      b.closingUntil = t + 0.12;
      b.nextAt = t + 1.8 + Math.random() * 3.5 + (Math.random() < 0.15 ? -1.5 : 0);
    }
    b.value += ((t < b.closingUntil ? 1 : 0) - b.value) * ease(40);
    let closure = 0;
    for (const [name, c] of Object.entries(EYE_CLOSURE)) closure = Math.max(closure, (target[name] ?? 0) * c);
    put("まばたき", b.value * (1 - closure));

    // Ease every morph we have touched toward its target (absent = 0).
    const influences = this.mmd.mesh.morphTargetInfluences!;
    for (const name of new Set([...this.morphNow.keys(), ...Object.keys(target)])) {
      const index = this.morphIndex.get(name);
      if (index === undefined) continue;
      const isMouth = name in VOWEL_INDEX || name === "まばたき";
      const now = this.morphNow.get(name) ?? 0;
      const next = now + ((target[name] ?? 0) - now) * ease(isMouth ? 30 : 10);
      if (next < 0.001 && !(name in target)) this.morphNow.delete(name);
      else this.morphNow.set(name, next);
      influences[index] = next;
    }
  }
}

const VOWEL_INDEX = Object.fromEntries(Object.values(VOWEL_MORPHS).map((m) => [m, true]));

/** How far each bone turns (Euler XYZ) to look toward the normalized pointer position. */
function gazeTurn(x: number, y: number): Record<"neck" | "head" | "chest" | "eyes", V3> {
  return {
    neck: [-y * 0.08, x * 0.15, 0],
    head: [-y * 0.15, x * 0.3, 0],
    chest: [0, x * 0.06, 0],
    eyes: [-y * 0.12, x * 0.3, 0],
  };
}
function mirror(v: V3, side: 1 | -1) {
  return new Vector3(v[0] * side, v[1], v[2]).normalize();
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function lerp3(a: V3, b: V3, w: number): V3 {
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}
function blendArm(a: Arm, b: Arm, w: number): Arm {
  return {
    upper: lerp3(a.upper, b.upper, w),
    fore: lerp3(a.fore, b.fore, w),
    fingers: a.fingers.map((f, i) => f + (b.fingers[i] - f) * w) as Fingers,
  };
}
function blendBody(a: Body, b: Body, w: number): Body {
  return {
    l: blendArm(a.l, b.l, w),
    r: blendArm(a.r, b.r, w),
    center: lerp3(a.center, b.center, w),
    hips: lerp3(a.hips, b.hips, w),
    chest: lerp3(a.chest, b.chest, w),
    neck: lerp3(a.neck, b.neck, w),
    head: lerp3(a.head, b.head, w),
    shrug: a.shrug + (b.shrug - a.shrug) * w,
  };
}
function easeInOut(p: number) {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
