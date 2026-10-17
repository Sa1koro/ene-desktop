/** Character files found under public/models when the app is built (see scripts/models.mjs). */
declare module "virtual:models" {
  /** URL path of the MMD model (.pmx) to load, if there is one. */
  export const mmd: string | null;
  /** URL path of the VRM model to load when there is no MMD model. */
  export const vrm: string | null;
  /** File names of the VMD motions in public/models/motions/, e.g. "idle.vmd". */
  export const motions: string[];
}
