import type { Object3D } from "three";
import type { Emotion } from "../emotion";

/** One-shot gestures. */
export type Gesture = "wave" | "jump" | "victory" | "nod" | "shake" | "spin" | "poke";

/** Looping "busy" poses shown while ENE works on something. */
export type BusyPose = "think" | "dive" | "typing" | "listen";

/**
 * A body for ENE. The director only talks to this interface, so the procedural
 * chibi and a VRM model are interchangeable (and a Live2D body can be added later).
 */
export interface Avatar {
  readonly root: Object3D;
  setEmotion(emotion: Emotion): void;
  /** 0 = closed, 1 = wide open. Driven by speech. */
  setMouth(open: number): void;
  /** Normalized pointer position, -1..1 on both axes. */
  lookAt(x: number, y: number): void;
  play(gesture: Gesture): void;
  setBusy(pose: BusyPose | null): void;
  update(dt: number, elapsed: number): void;
}
