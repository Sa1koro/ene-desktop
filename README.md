# ENE Desktop

给 OpenClaw 智能体 **ENE** 做的桌面宠物身体。ENE 浮在桌面上的一个透明、置顶的小窗口里，
用漫画气泡说话，逐句变换表情，还会把「大脑」正在做的事演出来：
搜索时潜进网络，运行命令时疯狂打字，用工具答完题后摆出胜利姿势。

- 不连 OpenClaw 也能直接看效果：她会眨眼、呼吸、看向鼠标，被戳会有反应。
- 连上 OpenClaw 后就能聊天：表情和口型跟着回复逐句变化。

## 快速开始（新手看这里）

### 1. 安装 Node.js

到 <https://nodejs.org/> 下载 **Node.js 22 LTS**（或更新的版本），安装时一路点「下一步」即可。

### 2. 下载本项目

用 `git clone`，或者在 GitHub 页面点 **Code → Download ZIP** 后解压。

### 3. 双击启动

| 文件 | 作用 | 需要什么 |
|---|---|---|
| **`start.bat`** | 一键启动。装了 Rust 就打开桌面宠物窗口；没装 Rust 就在浏览器里预览 | Node.js（桌面窗口还需要 Rust） |
| `start-browser.bat` | 只在浏览器里预览 | Node.js |
| `build-exe.bat` | 打包成 `release\ENE.exe`，以后双击就能运行（见[打包成 exe](#打包成-exe编译完直接运行)） | Node.js、Rust、VS C++ 生成工具 |

第一次运行会先自动安装依赖（`npm install`），要等几分钟。之后再启动就很快。

- 启动后会出现一个黑色的命令行窗口，那是 ENE 的「后台」。**别关它**，关掉 ENE 也会跟着退出。
- 浏览器预览会自动打开 <http://127.0.0.1:1420>。
- 桌面版第一次启动要编译 Rust，可能要等几分钟。
- 想退出桌面版：右键 ENE → **退出**。浏览器预览直接关掉黑色窗口即可。
- macOS / Linux：运行 `sh start.sh`（只预览用 `sh start.sh browser`，打包用 `sh start.sh build`）。
- 习惯命令行的话：`npm start`、`npm run start:browser`、`npm run build:exe` 是同样的三个功能。

> 底部的「等待 ENE bridge…」提示是正常的，说明还没连上聊天服务（OpenClaw）。不影响看和戳。

### 4. 怎么玩

| 操作 | 效果 |
|---|---|
| 点击 ENE | 戳她，同时打开聊天框（2.5 秒内连戳 3 下她会生气） |
| 拖动 ENE | 移动窗口（仅桌面版） |
| Enter / Esc | 打开 / 收起聊天框 |
| ■ 按钮 | 中止当前回复（`chat.abort`） |
| 右键 | 菜单：聊天、置顶开关、重新加载、退出（置顶和退出仅桌面版有） |
| 移动鼠标 | ENE 的眼睛和头会跟着看 |

## 打包成 exe（编译完直接运行）

打包结果在 `release` 文件夹里：

- `ENE.exe`（约 13 MB）：界面和模型都在里面。
- `bridge` 文件夹（约 100 MB，大小看你装的 Node.js 版本）：聊天用的 bridge，自带一份 Node.js。

把整个 `release` 文件夹复制到任何位置，或者别的电脑上，双击 `ENE.exe` 就能运行。
要聊天，那台电脑上只需要有 OpenClaw 网关（见[连接 OpenClaw](#连接-openclaw聊天)），不用装 Node.js，也不需要本项目。

1. **安装 Rust**：到 <https://rustup.rs/> 下载 `rustup-init.exe`，运行后直接回车，使用默认选项。
   国内下载慢的话可以用 [rsproxy.cn](https://rsproxy.cn/) 镜像。
2. **安装 C++ 生成工具**：安装 [Visual Studio 2022 生成工具](https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/)，
   勾选 **「使用 C++ 的桌面开发」**。已经装了带这个组件的 Visual Studio 就不用再装。
3. **重新打开**命令行窗口（或重启电脑），让新装的工具生效。
4. **双击 `build-exe.bat`**。第一次编译要 3–15 分钟（看电脑性能），以后会快很多。
   完成后会自动打开 `release` 文件夹并选中 `ENE.exe`。

完整的环境要求见 Tauri 官方说明：<https://v2.tauri.app/start/prerequisites/>。

注意事项：

- **WebView2**：Windows 10/11 一般自带。如果 `ENE.exe` 打开后一片空白或报错，安装
  [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) 后再试。
- **`bridge` 文件夹要和 `ENE.exe` 放在一起**。打包时，`bridge/ene-bridge.mjs` 和它用到的库会合成一个文件
  `bridge\ene-bridge.cjs`，旁边再放一份打包用的 `node.exe`。`ENE.exe` 启动时就用这个 `node.exe` 运行 bridge。
  只把 `ENE.exe` 拷走的话，ENE 照样能运行，只是不能聊天。想从桌面打开，给 `ENE.exe` 创建快捷方式即可。
- 调试 bridge 时，可以用环境变量 `ENE_BRIDGE_SCRIPT` 指定一个 bridge 脚本，`ENE.exe` 会改用电脑上的 `node` 运行它。
- **想要安装包**（`setup.exe`）：运行 `npm run build:exe -- --installer`，第一次会从 GitHub 自动下载 NSIS。
  打出的 `ENE_<版本号>_x64-setup.exe`（约 35 MB）会复制到 `release` 文件夹，原件在 `src-tauri/target/release/bundle/nsis/`。
  安装包里同样带着聊天 bridge 和 Node.js，装好就能聊天。默认装到当前用户的 `%LOCALAPPDATA%\ENE`，
  不需要管理员权限，卸载在 Windows「设置 → 应用」里。只打 NSIS 安装包，不打 `.msi`。
- **模型会被打包进 exe**。把 exe 发给别人，就等于分发了模型，见[角色模型](#角色模型)。
- 改了代码或换了模型以后，要重新打包，exe 才会更新。

## 连接 OpenClaw（聊天）

```
┌──────────── Tauri 窗口（透明）──────────────────────────┐
│  three.js 舞台 ← Director ← BridgeClient (ws)          │
│  ChibiAvatar | MmdAvatar | VrmAvatar                   │
└───────────────────────────┬────────────────────────────┘
                            │ ws://127.0.0.1:18790（校验来源）
                ┌───────────┴───────────┐
                │ bridge/ene-bridge.mjs │  Ed25519 设备身份；
                │  @openclaw/gateway-   │  网关 token 永远不会
                │  client (Node)        │  进入网页
                └───────────┬───────────┘
                            │ ws://127.0.0.1:18789（Gateway 协议 v4）
                     OpenClaw 网关 → ENE 智能体（记忆、工具、人设）
```

先在本机运行 OpenClaw 网关，再启动 ENE：

- **桌面版**：会自动启动 bridge。
  - `start.bat`（`tauri dev`）用电脑上的 Node.js 运行 `bridge/ene-bridge.mjs`。
  - 打包出的 `ENE.exe` 和安装包装好的 ENE，都用 exe 旁边 `bridge` 文件夹里自带的 Node.js，电脑上不用装 Node.js。
- **浏览器预览**：检测到 OpenClaw（`~/.openclaw/openclaw.json` 或环境变量 `OPENCLAW_GATEWAY_TOKEN`）时，
  `start.bat` 会自动启动 bridge。也可以手动另开一个窗口运行 `npm run bridge`。

第一次连接时，会在网关上注册一个叫 **ENE Desktop** 的设备。

- 本机连接（loopback）会自动批准。
- 从别的电脑连接时，ENE 会显示一行提示：`openclaw devices approve <id>`，在网关上运行它即可批准。

bridge 的设置（环境变量）：

| 变量 | 默认值 |
|---|---|
| `ENE_SESSION_KEY` | `agent:main:main`（和网页聊天是同一个会话） |
| `ENE_GATEWAY_URL` | `ws://127.0.0.1:18789` |
| `ENE_BRIDGE_PORT` | `18790` |
| `OPENCLAW_GATEWAY_TOKEN` | 从 `~/.openclaw/openclaw.json` 读取 |
| `ENE_STATE_DIR` | `%APPDATA%\ene-desktop`（设备密钥和签发的 token） |

## 角色模型

程序会自动使用 `public/models/` 里找到的模型，不需要改代码。选择顺序：

1. 第一个 `.pmx`（MMD 模型，按路径排序）
2. 没有 `.pmx` 时，用第一个 `.vrm`
3. 都没有时，显示内置的 Q 版 ENE

启动窗口里会打印实际用的是哪个模型。

**换模型**：

1. 把整个模型文件夹放进 `public/models/`。`.pmx` 和 `tex`、`toon`、`spa` 等贴图文件夹要保持原来的相对位置。
2. 把原来的模型移走。
3. 重新启动 ENE；浏览器预览只要刷新页面。`ENE.exe` 要重新打包（双击 `build-exe.bat`）才会换上新模型。

### 当前模型

`public/models/ENE/ENE1.00.pmx` 是 **YYB式ENE 1.00**（建模与物理：YYB，见 PMX 文件内的署名）。
ENE 这个角色出自《カゲロウプロジェクト》（阳炎计划）。

> 公开仓库、再分发模型，或者把含模型的 exe 发给别人之前，请先确认模型作者的使用条款允许这样做。

### 三种身体

所有身体都实现 `src/avatar/types.ts` 里的接口，以后也可以加 Live2D 身体。

- **Q 版 ENE**（ChibiAvatar，没有模型时使用）
  - 完全由基本几何体搭成：卡通着色、描边、画布绘制的动漫脸（8 种表情）、
    弹簧模拟的双马尾、会发光的耳机。
  - 不需要下载任何东西，也没有版权问题。
- **MMD 模型**（MmdAvatar），表现力最强：
  - **表情**：每种心情都用模型自带的表情变形组合而成，每次从 2–3 种变化里随机挑一种。
    例如兴奋时星星眼、`[love]` 时爱心眼、得意时的 `じと目` 半眯眼、吐舌眨眼、青筋、惊吓线、汗、眼泪、三档脸红。
  - **口型同步**：按念到的字选 あ/い/う/え/お（假名精确对应，汉字轮换）。
  - **身体姿势**：手臂、脊柱、头、眼睛、手指都由程序摆姿势，每种心情都有对应的肢体语言。
    例如生气时叉腰、思考时托腮、害羞时双手交握、胜利时眨眼比 V。屈膝时腿部 IK 让脚保持着地。
  - **物理**：模型自带的刚体（Ammo.js）让双马尾、刘海和裙子摆动。PMX 的描边设置会变成卡通描边。
  - **VMD 动作**：可以叠加 MMD 社区的 VMD 动作，见下文。
- **VRM 模型**（VrmAvatar）
  - 可以用 VRoid Studio（免费）制作，导出 VRM 1.0 格式。
  - 表情映射到 VRM 预设表情，头发使用模型自带的弹簧骨骼。

## VMD 动作（可选）

模型本身不带动作，ENE 的动作默认由程序生成。把 MMD 社区的 `.vmd` 动作文件放进
`public/models/motions/`，就能替换对应的动作：

| 文件名 | 什么时候播放 |
|---|---|
| `idle.vmd` | 心情平静、没在忙的时候循环播放，代替默认站姿 |
| `wave.vmd` | 连上 OpenClaw 打招呼时；闲着时随机 |
| `jump.vmd` | 心情变兴奋或吃惊时 |
| `victory.vmd` | 用了工具的回答说完时 |
| `nod.vmd` | 你发出消息时；心情变难过时 |
| `shake.vmd` | 出错时；心情变生气时 |
| `spin.vmd` | 闲着时随机 |
| `poke.vmd` | 被戳时 |

- 放好文件后刷新页面（或重新启动）即可生效；`ENE.exe` 要重新打包才会带上新动作。
- 动作会平滑地淡入淡出，没放文件的动作照旧由程序生成。
- **表情和口型永远由程序控制**：VMD 里的表情帧会被忽略。眼睛和头仍然会跟着鼠标转。
- VMD 只控制它有关键帧的骨骼，其余骨骼保持程序姿势。
- 想先看看效果：运行 `npm run vmd:demo` 生成两个示例动作，刷新页面后：
  - 心情平静时，`idle` 会让 ENE 平伸双臂左右摇摆；
  - 在开发者工具控制台运行 `ene.avatar.play("victory")`，她会双手高举。
  - 删掉示例动作：`npm run vmd:demo -- --clean`。
- `public/models/motions/` 不会被提交到 git，因为社区动作通常有自己的使用条款。

实现细节见 [docs/vmd-motions.md](docs/vmd-motions.md)。

## 表情标签

ENE 的心情有两个来源：

1. **表情标签**：她可以在回复里写 `[happy]`、`[excited]`、`[smug]`、`[angry]`、`[surprised]`、
   `[sad]`、`[thinking]`、`[shy]`、`[love]`，也支持 `[pout]`、`[grin]`、`[blush]`、`[heart]` 等别名。
   标签在显示前会被去掉，并在句子里的那个位置切换表情。
2. **启发式判断**：句子没有标签时，根据 emoji、颜文字和口癖判断心情，例如 `☆`、`😏`、`笨蛋`、`呜`、`欸？！`。

只靠启发式也能用。想让她刻意地演，可以在智能体的工作区（例如 `AGENTS.md`）加上这样一段：

```md
## Desktop body
When chatting through ENE Desktop, you may start a sentence with one emotion tag:
[happy] [excited] [smug] [angry] [surprised] [sad] [thinking] [shy] [love]. Use them sparingly,
only when your mood actually changes. They are hidden from the user.
```

## 常见问题

| 现象 | 解决办法 |
|---|---|
| 双击 `start.bat` 提示没有找到 Node.js | 安装 Node.js 22 LTS，装完重新双击 |
| `npm install` 很慢或失败 | 运行 `npm config set registry https://registry.npmmirror.com`，然后重新启动 |
| 提示端口 1420 被占用 | 已经有一个 ENE 或别的程序在用这个端口。关掉它再启动；如果是另一个 ENE 窗口，脚本会直接复用它 |
| 只看到 Q 版 ENE，没有 MMD 模型 | 检查 `public/models/` 里有没有 `.pmx` 文件。启动窗口会打印找到的模型；按 F12 看控制台有没有加载报错 |
| 桌面版第一次启动很慢 | 正在编译 Rust，只有第一次慢 |
| 编译报错 `link.exe not found` | 没装 C++ 生成工具，见[打包成 exe](#打包成-exe编译完直接运行)第 2 步 |
| 打包时提示复制失败 | `ENE.exe` 还开着。先右键 ENE → 退出，再打包 |
| `ENE.exe` 打开后空白 | 安装 WebView2 Runtime |
| 一直显示「等待 ENE bridge…」，不能聊天 | 没连上 OpenClaw，见[连接 OpenClaw](#连接-openclaw聊天)。打包版还要检查 `bridge` 文件夹是不是和 `ENE.exe` 在一起。不聊天的话可以忽略 |
| ENE 窗口找不到了 | 在任务栏找 ENE，或者在任务管理器里结束 `ENE.exe` / `ene-desktop.exe` |

## 开发

| 命令 | 作用 |
|---|---|
| `npm start` | 同 `start.bat`：桌面版（`tauri dev`），没有 Rust 时改用浏览器预览 |
| `npm run start:browser` | 同 `start-browser.bat`：Vite 开发服务器 + 浏览器 |
| `npm run build:exe` | 同 `build-exe.bat`：打包 bridge，`tauri build --no-bundle`，再把 `ENE.exe` 和 `bridge/` 复制到 `release/` |
| `npm run build:exe -- --installer` | 打包 bridge，`tauri build --bundles nsis`，再把带 bridge 的安装包复制到 `release/` |
| `npm run tauri dev` | 直接启动 Tauri 开发模式（会自动启动 Vite 和 bridge） |
| `npm run dev` / `npm run bridge` | 分别启动 Vite 和 bridge，适合浏览器里调试 |
| `npm run build` | 类型检查 + 前端构建到 `dist/` |
| `npm run typecheck` | 只做类型检查 |
| `npm run vmd:demo` | 生成 / 删除（`-- --clean`）示例 VMD 动作 |

开发模式下，浏览器控制台里的 `window.ene` 可以访问当前的 `avatar`、`director` 和 `stage`。

### 目录结构

```
start.bat / start-browser.bat / build-exe.bat / start.sh   一键启动和打包
scripts/launch.mjs      启动脚本的实际逻辑（装依赖、选模式、打包）
scripts/models.mjs      在 public/models 里查找模型和 VMD 动作（构建时交给程序）
scripts/bundle-bridge.mjs  打包时把 bridge 合成一个文件，连同 Node.js 放进 exe 旁边的 bridge/
scripts/make-test-vmd.mjs  生成示例 VMD 动作
bridge/ene-bridge.mjs   OpenClaw 网关连接 + 本地 WebSocket 协议
src/director.ts         事件 → 说话、心情、姿势、闲时小动作
src/emotion.ts          表情标签解析、心情启发式、markdown → 朗读文本
src/avatar/chibi.ts     程序生成的 Q 版 ENE
src/avatar/face.ts      画布绘制的动漫脸
src/avatar/mmd.ts       MMD (PMX) 身体：表情、口型、程序姿势、物理、VMD 动作
src/avatar/vrm.ts       VRM 身体
src/stage.ts            three.js 场景、全息底座、闪光粒子
src/ui.ts               气泡、状态提示、聊天框、右键菜单
src-tauri/              透明窗口 + bridge 进程管理
public/models/          角色模型（和可选的 motions/ 动作）
docs/                   实现说明
release/                打包出的 ENE.exe、bridge/ 和安装包（不提交到 git）
```

### 路线图

- [x] 第 1 阶段：桌面宠物、表情系统、聊天、工具调用动画
- [ ] 第 2 阶段：语音。在实验室的 GTX 1080 上跑 faster-whisper 语音识别 + GPT-SoVITS/CosyVoice 语音合成，用音量驱动口型
- [ ] 第 3 阶段：根据心跳和定时任务主动行动，审批界面
- [ ] 第 4 阶段：Live2D 身体；~~把 bridge 作为 Tauri sidecar 打进安装包~~（已完成，bridge 作为资源文件打进了安装包）
