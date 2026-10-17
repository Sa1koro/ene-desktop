// One-click launcher behind start.bat / start.sh / `npm start`. Plain Node with no
// dependencies, so it runs before `npm install` and does the install itself.
//
//   node scripts/launch.mjs           ENE as a desktop pet (tauri dev); without Rust it
//                                     falls back to the browser preview
//   node scripts/launch.mjs browser   browser preview at http://127.0.0.1:1420 (Node only)
//   node scripts/launch.mjs build     standalone release/ENE.exe plus the bridge/ folder it
//                                     chats through (needs Rust)
//   node scripts/launch.mjs build --installer
//                                     a Windows installer (NSIS setup.exe) with the same
//                                     bridge/ inside, copied to release/
//
// --no-open skips opening the browser or the release folder.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findModels } from "./models.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Fixed: it is Tauri's devUrl and the only page origin the bridge accepts.
const APP_URL = "http://127.0.0.1:1420/";
const BRIDGE_PORT = Number(process.env.ENE_BRIDGE_PORT ?? 18790);
const TAURI = "node_modules/@tauri-apps/cli/tauri.js";
const isWin = process.platform === "win32";
const flags = process.argv.slice(2);
const mode = flags.find((f) => !f.startsWith("-")) ?? "desktop";
const openThings = !flags.includes("--no-open");

const say = (msg) => console.log(`\x1b[36m[ENE]\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m[ENE]\x1b[0m ${msg}`);
function fail(msg) {
  console.error(`\x1b[31m[ENE]\x1b[0m ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- helpers

/** Runs a program in the project folder with its output shown; resolves to its exit code. */
function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", ...options });
    child.on("error", (err) => {
      warn(`${command} 启动失败：${err.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
const node = (script, args = []) => run(process.execPath, [join(ROOT, script), ...args]);
// npm and cargo are .cmd/.exe shims on Windows, so they go through the shell.
const shell = (commandLine) => run(commandLine, [], { shell: true });
const succeeds = (commandLine) => spawnSync(commandLine, { shell: true, stdio: "ignore" }).status === 0;

/** "free", "ene" (an ENE dev server already answers) or "other". */
async function appPort() {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    return (await res.text()).includes("<title>ENE</title>") ? "ene" : "other";
  } catch {
    return "free";
  }
}

const portInUse = (port) =>
  new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

function openExternal(target) {
  const [command, args] = isWin
    ? ["cmd", ["/c", "start", "", target]]
    : [process.platform === "darwin" ? "open" : "xdg-open", [target]];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

/** Opens Explorer with `file` selected (Windows only, skipped with --no-open). */
function showInFolder(file) {
  if (openThings && isWin)
    spawn("explorer", [`/select,"${file}"`], { windowsVerbatimArguments: true, stdio: "ignore", detached: true }).unref();
}

// ---------------------------------------------------------------- checks

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  // Vite 8 needs ^20.19 or >=22.12.
  const ok = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
  if (!ok) fail(`Node.js ${process.versions.node} 太旧了，请安装 Node.js 22 LTS 或更新版本：https://nodejs.org/`);
}

async function ensureDependencies() {
  const stamp = join(ROOT, "node_modules", ".package-lock.json");
  const lock = join(ROOT, "package-lock.json");
  if (existsSync(stamp) && statSync(stamp).mtimeMs >= statSync(lock).mtimeMs) return;
  say("正在安装依赖（npm install），第一次运行要几分钟…");
  if ((await shell("npm install")) !== 0)
    fail("依赖安装失败。网络慢的话先运行  npm config set registry https://registry.npmmirror.com  再重试。");
  // npm leaves the stamp alone when nothing changed; touch it so the next start skips this.
  if (existsSync(stamp)) utimesSync(stamp, new Date(), new Date());
}

function reportModel() {
  const { mmd, vrm, motions } = findModels(ROOT);
  if (mmd || vrm) say(`角色模型：public${mmd ?? vrm}`);
  else warn("public/models 里没有模型，会显示内置的 Q 版 ENE（放模型的方法见 README）。");
  if (motions.length) say(`VMD 动作：${motions.join("、")}`);
}

function rustReady() {
  if (!succeeds("cargo --version")) return false;
  if (isWin && !hasMsvc())
    warn("没检测到 Visual Studio 的「使用 C++ 的桌面开发」组件，编译可能失败（安装方法见 README）。");
  return true;
}

function hasMsvc() {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Microsoft Visual Studio\\Installer\\vswhere.exe",
  );
  if (!existsSync(vswhere)) return false;
  const res = spawnSync(
    vswhere,
    ["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
    { encoding: "utf8" },
  );
  return res.status === 0 && res.stdout.trim() !== "";
}

// ---------------------------------------------------------------- modes

async function desktop() {
  if (!rustReady()) {
    warn("没找到 Rust，暂时打不开桌面窗口，先用浏览器预览。想要桌面版：按 README 装好 Rust 后再运行一次。");
    return browser();
  }
  const port = await appPort();
  if (port === "other") fail("端口 1420 被别的程序占用了，请先关掉它（ENE 只能用这个端口）。");
  const args = ["dev"];
  // Reuse an ENE dev server that is already running instead of starting a second one.
  if (port === "ene") args.push("--config", JSON.stringify({ build: { beforeDevCommand: null } }));
  say("启动桌面版 ENE（tauri dev）。第一次要编译 Rust，可能要等几分钟，以后就快了…");
  say("关闭方法：右键 ENE → 退出，或者直接关掉这个窗口。");
  return node(TAURI, args);
}

async function browser() {
  const port = await appPort();
  if (port === "other") fail("端口 1420 被别的程序占用了，请先关掉它（ENE 只能用这个端口）。");
  if (port === "ene") {
    say(`ENE 已经在运行了：${APP_URL}`);
    if (openThings) openExternal(APP_URL);
    return 0;
  }

  let bridge = null;
  const openclawConfig = process.env.OPENCLAW_CONFIG ?? join(homedir(), ".openclaw", "openclaw.json");
  if (!process.env.OPENCLAW_GATEWAY_TOKEN && !existsSync(openclawConfig))
    say("没检测到 OpenClaw，不启动聊天 bridge：ENE 照样能看、能戳，只是不能聊天。");
  else if (await portInUse(BRIDGE_PORT)) say("聊天 bridge 已经在运行。");
  else {
    say("启动聊天 bridge（连接 OpenClaw 网关）…");
    bridge = spawn(process.execPath, [join(ROOT, "bridge", "ene-bridge.mjs")], { cwd: ROOT, stdio: "inherit" });
  }

  say("启动预览服务器（Vite）…");
  const vite = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const exited = new Promise((resolve) => vite.on("exit", resolve));
  let up = false;
  for (let i = 0; i < 120 && vite.exitCode === null && !up; i++) {
    up = (await appPort()) === "ene";
    if (!up) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!up) {
    bridge?.kill();
    vite.kill();
    fail("预览服务器没能启动，请看上面的报错。");
  }
  say(`ENE 已经在浏览器里打开：${APP_URL}`);
  say("要关闭 ENE，关掉这个窗口（或按 Ctrl+C）即可。");
  if (openThings) openExternal(APP_URL);
  await exited;
  bridge?.kill();
  return 0;
}

async function build() {
  if (!rustReady()) fail("打包 exe 需要 Rust 和 Visual Studio C++ 生成工具，安装方法见 README 的「打包成 exe」。");
  const installer = flags.includes("--installer");
  // main.rs finds the bridge next to the exe, which is where only Windows installers put it.
  if (installer && !isWin) fail("安装包目前只支持 Windows。macOS / Linux 请去掉 --installer，用打包出的 release 文件夹。");
  say("打包聊天 bridge，并带上本机的 Node.js，这样别的电脑不装 Node.js 也能聊天…");
  // Imported only now: it needs the dependencies that ensureDependencies() installs.
  const { bundleBridge } = await import("./bundle-bridge.mjs");
  const resources = await bundleBridge(ROOT).catch((err) => fail(`聊天 bridge 打包失败：${err.message}`));
  say("开始打包（tauri build）。第一次编译 release 版要 3–15 分钟，请耐心等…");
  if (installer) say("第一次打安装包还会从 GitHub 下载 NSIS。");
  // The bridge is added here rather than in tauri.conf.json, so `tauri dev` never needs it.
  // Installers get the same resources. NSIS only: it installs per user without admin
  // rights, while MSI would mean a second tool download (WiX) and a second copy of Node.js.
  const config = JSON.stringify({ bundle: { resources } });
  const bundles = installer ? ["--bundles", "nsis"] : ["--no-bundle"];
  if ((await node(TAURI, ["build", ...bundles, "--config", config])) !== 0) fail("打包失败，请看上面的报错。");

  const built = join(ROOT, "src-tauri", "target", "release");
  if (installer) return copyInstaller(join(built, "bundle", "nsis"));

  // The exe looks for its bridge/ folder next to itself, so both go to release/.
  const out = join(ROOT, "release", isWin ? "ENE.exe" : "ENE");
  const copies = [[isWin ? "ene-desktop.exe" : "ene-desktop", out]];
  for (const file of Object.values(resources)) copies.push([file, join(ROOT, "release", file)]);
  try {
    for (const [from, to] of copies) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(built, from), to);
    }
  } catch (err) {
    fail(`没能复制到 ${dirname(out)}（${err.code}）。如果 ENE 正在运行，先右键 ENE → 退出，再重新打包。`);
  }
  say(`打包完成：${out}`);
  say("以后双击它就能直接运行，不用再开命令行。");
  say("旁边的 bridge 文件夹是聊天用的（里面带着 Node.js），复制或移动 ENE 时要连它一起。");
  showInFolder(out);
  return 0;
}

/** Copies the installer that `tauri build` just made in `dir` to release/. */
function copyInstaller(dir) {
  const [setup] = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((file) => file.endsWith("-setup.exe"))
    .map((file) => join(dir, file))
    // Installers of older versions stay in the folder; the newest one is this build's.
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!setup) fail(`在 ${dir} 里没找到安装包，请看上面的输出。`);
  const out = join(ROOT, "release", basename(setup));
  try {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(setup, out);
  } catch (err) {
    fail(`没能复制到 ${dirname(out)}（${err.code}）。如果这个安装包正开着，先关掉它，再重新打包。`);
  }
  say(`安装包打包完成：${out}`);
  say("双击它安装 ENE，装在当前用户下，不需要管理员权限。");
  say("聊天用的 bridge（带着 Node.js）也在安装包里，装好就能聊天。");
  showInFolder(out);
  return 0;
}

// ---------------------------------------------------------------- main

const modes = { desktop, browser, build };
if (!Object.hasOwn(modes, mode)) fail(`不认识的模式 "${mode}"，可选：desktop、browser、build`);
// Ctrl+C reaches the child processes as well; let them shut down, then exit with them.
process.on("SIGINT", () => {});
checkNode();
await ensureDependencies();
reportModel();
process.exit(await modes[mode]());
