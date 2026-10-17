// Writes two synthetic VMD motions so VMD playback can be seen without downloading any:
//   victory.vmd  both arms straight up, forearms pumping, knees bobbing (2 s);
//                its morph keys (mouth open, eyes shut, angry brows) must be ignored
//   idle.vmd     arms held out like wings, torso swaying (4 s loop)
//
//   npm run vmd:demo                 write them to public/models/motions/
//   npm run vmd:demo -- --clean      delete them again
//   node scripts/make-test-vmd.mjs [outDir] [--force]   (--force overwrites existing files)
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const outDir =
  args.find((a) => !a.startsWith("--")) ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "motions");
const FILES = ["victory.vmd", "idle.vmd"];

if (args.includes("--clean")) {
  for (const file of FILES) rmSync(join(outDir, file), { force: true });
  if (existsSync(outDir) && readdirSync(outDir).length === 0) rmdirSync(outDir);
  console.log(`removed ${FILES.join(", ")} from ${outDir}`);
  process.exit(0);
}

// Shift-JIS encoder, built by inverting the platform decoder.
const decoder = new TextDecoder("shift_jis");
const sjis = new Map();
for (let lead = 0x81; lead <= 0xfc; lead++) {
  if (lead > 0x9f && lead < 0xe0) continue;
  for (let trail = 0x40; trail <= 0xfc; trail++) {
    const ch = decoder.decode(new Uint8Array([lead, trail]));
    if (ch.length === 1 && ch !== "�" && !sjis.has(ch)) sjis.set(ch, [lead, trail]);
  }
}
function encode(text, size) {
  const out = new Uint8Array(size);
  let i = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const bytes = code < 0x80 ? [code] : sjis.get(ch);
    if (!bytes) throw new Error(`no Shift-JIS for ${ch}`);
    for (const b of bytes) out[i++] = b;
  }
  return out;
}

// Rotation about the model's front axis (Z is the same in MMD and three.js space).
const rz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const none = [0, 0, 0, 1];

function vmd(keys, morphs = []) {
  const size = 30 + 20 + 4 + keys.length * 111 + 4 + morphs.length * 23 + 4 * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(encode("Vocaloid Motion Data 0002", 30), 0);
  bytes.set(encode("test", 20), 30);
  let o = 50;
  view.setUint32(o, keys.length, true);
  o += 4;
  for (const { bone, frame, pos = [0, 0, 0], rot = none } of keys) {
    bytes.set(encode(bone, 15), o);
    view.setUint32(o + 15, frame, true);
    pos.forEach((v, i) => view.setFloat32(o + 19 + i * 4, v, true));
    rot.forEach((v, i) => view.setFloat32(o + 31 + i * 4, v, true));
    // Linear bezier (20,20)-(107,107) for X, Y, Z and rotation.
    for (let i = 0; i < 4; i++) {
      bytes[o + 47 + i] = 20;
      bytes[o + 47 + 4 + i] = 20;
      bytes[o + 47 + 8 + i] = 107;
      bytes[o + 47 + 12 + i] = 107;
    }
    o += 111;
  }
  view.setUint32(o, morphs.length, true);
  o += 4;
  for (const { morph, frame, weight } of morphs) {
    bytes.set(encode(morph, 15), o);
    view.setUint32(o + 15, frame, true);
    view.setFloat32(o + 19, weight, true);
    o += 23;
  }
  // camera, light, self shadow and property key counts stay 0
  return bytes;
}

const victory = [];
for (const [frame, bend, bob] of [
  [0, 0, 0],
  [10, 0.7, -0.8],
  [20, 0, 0],
  [30, 0.7, -0.8],
  [40, 0, 0],
  [50, 0.7, -0.8],
  [60, 0, 0],
]) {
  victory.push(
    { bone: "右腕", frame, rot: rz(-1.9) },
    { bone: "左腕", frame, rot: rz(1.9) },
    { bone: "右ひじ", frame, rot: rz(-bend) },
    { bone: "左ひじ", frame, rot: rz(bend) },
    { bone: "センター", frame, pos: [0, bob, 0] },
  );
}
// Face keys the app must ignore: mouth wide open, eyes shut, angry brows.
const face = ["あ", "まばたき", "怒り"].flatMap((morph) => [
  { morph, frame: 0, weight: 1 },
  { morph, frame: 60, weight: 1 },
]);

const idle = [];
for (const [frame, sway] of [
  [0, 0],
  [30, 0.12],
  [60, 0],
  [90, -0.12],
  [120, 0],
]) {
  idle.push(
    { bone: "右腕", frame, rot: rz(-0.55) },
    { bone: "左腕", frame, rot: rz(0.55) },
    { bone: "上半身", frame, rot: rz(sway) },
    { bone: "頭", frame, rot: rz(-sway) },
  );
}

mkdirSync(outDir, { recursive: true });
const motions = { "victory.vmd": vmd(victory, face), "idle.vmd": vmd(idle) };
for (const [file, data] of Object.entries(motions)) {
  const path = join(outDir, file);
  if (existsSync(path) && !args.includes("--force")) {
    console.log(`skipped ${path}: it already exists (--force overwrites it)`);
    continue;
  }
  writeFileSync(path, data);
  console.log(`wrote ${path}`);
}
