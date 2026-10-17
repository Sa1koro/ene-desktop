# VMD 动作播放：实现说明

面向想改代码的人。使用方法见 [README 的「VMD 动作」](../README.md#vmd-动作可选)。
代码全部在 [`src/avatar/mmd.ts`](../src/avatar/mmd.ts) 的 `VMD motions` 一节和 `playMotions()` 里。

## 加载

- 有哪些动作文件，是在构建时由 [`scripts/models.mjs`](../scripts/models.mjs) 扫描
  `public/models/motions/` 得到的，通过虚拟模块 `virtual:models` 的 `motions` 交给程序。
  - 开发模式下，增删文件后刷新页面即可。
  - exe 里的列表在打包时就定下了，改了要重新打包。
- 不在运行时用 HEAD 请求探测文件是否存在，原因是 Tauri 会把它不认识的文件类型
  （`.pmx`、`.vmd`）当作 `text/html` 返回，和找不到文件时的回退页面一模一样，无法区分。
  模型本身也是用同样的方式找到的。
- MMD 身体建好后，构造函数在后台调用 `loadMotions()`，不阻塞模型加载。
- 列表里有的 `idle`、`wave`、`jump`、`victory`、`nod`、`shake`、`spin`、`poke` 动作，
  用 `VMDLoader` 读入，再用 `buildAnimation` 生成 `AnimationClip`。
  没有动作文件时不发任何请求，行为和以前完全一样。
- `buildAnimation` 会把位置关键帧叠加在骨骼的**当前**位置上，
  所以 `buildClip()` 构建前先把骨骼位置临时恢复到初始姿势。
- `buildClip()` 会删掉所有 `.morphTargetInfluences` 轨道（表情由程序自己控制，见下文）。
  一个能匹配到模型骨骼的轨道都没有的 VMD 会被跳过，并在控制台给出警告。

## 播放规则

- **idle.vmd**：心情为 neutral 且没有忙碌姿势时循环播放，以 `ease(3)` 淡入淡出。
  程序动作播放时按 `(1 - 程序动作权重)` 让位，保证程序动作看得见。
- **&lt;动作&gt;.vmd**：替换同名的程序动作。
  - 淡入时长为 min(0.3 秒, 动作长度的 25%)，淡出时长为 min(0.4 秒, 30%)。
  - 新动作开始时，正在播的 VMD 动作在 0.3 秒内淡出。
  - 动作长度取 `clip.duration`；只有一帧的姿势 VMD 长度为 0，改用 `GESTURE_SECONDS`。
- **按骨骼混合**：VMD 里有关键帧的骨骼，从程序姿势开始混合；`poseBody` 不控制的骨骼从初始姿势开始。
  混合顺序是先 idle 后动作。VMD 没打关键帧的骨骼完全保持程序姿势（呼吸、心情姿势等）。

## 为什么用「替身骨架」

每个图层的 `AnimationMixer` 驱动的是一副替身骨架：一个 `Object3D`，带
`skeleton.bones`，里面是新建的 `Bone`。它不直接驱动模型的骨骼。

原因是 three.js 的 `PropertyMixer` 只在数值**变化**时才写回目标对象。
如果直接驱动真实骨骼，再从骨骼上读出采样值，读到的可能是上一帧混合后的结果。
替身骨架只有 mixer 在写，所以里面永远是这一帧的 VMD 采样。

## 表情和视线

- **表情**：VMD 的表情轨道已被删掉，所以心情、眨眼、口型同步永远由程序决定。
  VMD 动作播放时，仍会叠加同名程序动作自带的表情，按动作权重缩放。
  例如 victory 的眨眼（ウィンク），以及 `袖小`（缩短袖子，让手露出来）。
- **视线**：混合之后，脖子、头、胸和眼睛会再叠加一次视线转动，
  权重等于这根骨骼的姿势中来自 VMD 的比例。所以 VMD 控制头部时，ENE 仍然会看向鼠标。
  视线的角度计算由 `gazeTurn()` 统一提供。

## 每帧顺序

```
mmd.beforeUpdate()
→ 程序姿势 poseBody()
→ 各图层 mixer.update(dt)（写入替身骨架）
→ 按权重混合到真实骨骼，补回视线
→ mmd.updateAnimation(主导图层的 mixer)   // 处理 VMD 里开关 IK 的属性帧
→ 表情、根节点
→ mmd.update(dt)
```

没有调用 `updateWithMixer()`，也就没有在同一帧里重复更新。

## 测试

`npm run vmd:demo` 会生成两个人造动作（见 [`scripts/make-test-vmd.mjs`](../scripts/make-test-vmd.mjs)）：

| 文件 | 内容 |
|---|---|
| `victory.vmd` | 双手高举、小臂上下挥动、屈膝起伏，共 2 秒。还带有张嘴、闭眼、怒眉的表情帧，用来验证程序会忽略它们 |
| `idle.vmd` | 双臂平伸、上身左右摇摆，4 秒一循环 |

验证过的结果：

| 情况 | 结果 |
|---|---|
| 没有动作文件 | 没有加载任何 clip，`idle` 为 null，程序动作和以前一致 |
| idle.vmd | 手臂角度等于 VMD 的值（31.5°）；VMD 没控制的手肘保持程序姿势；VMD 控制头部时视线仍能转动 ±17.2° |
| victory.vmd | 双臂举到 108.9°，并带屈膝 |
| VMD 的表情帧 | 被忽略：`あ`、`まばたき`、`怒り` 保持 0，口型同步照常驱动 `い` |
| idle 播放中触发程序动作 wave | idle 权重降到 0，挥手看得见 |
| 心情变为 angry，或进入 typing 忙碌姿势 | idle 淡出，之后再淡入 |

### 调试技巧

- 开发模式下，`window.ene.avatar` 就是当前身体，可以查看 `clips`、`idle`、`moves`、`idleOn` 等字段。
- 浏览器面板被隐藏时，`requestAnimationFrame` 不会运行。
  可以手动逐帧推进：循环调用 `ene.avatar.update(dt, t)`。
- 截图前先执行 `ene.stage.clock.getDelta = () => 0` 冻结时间，截到的画面就是当前状态。

试完删掉示例动作：`npm run vmd:demo -- --clean`。
