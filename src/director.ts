import type { Avatar, BusyPose } from "./avatar/types";
import type { BridgeEvent } from "./bridge";
import { inferEmotion, parseEmotionTags, toSpeech, type Emotion, type EmotionCue } from "./emotion";
import type { Stage } from "./stage";
import type { Bubble, ChatInput, Chip } from "./ui";

// What ENE does while a tool runs. Unknown tools fall back to "typing".
const TOOL_STYLES: Array<[RegExp, BusyPose, string]> = [
  [/search|fetch|browser|web|http/i, "dive", "🔎 潜入网络中…"],
  [/memory|recall|dream/i, "think", "🧠 翻记忆中…"],
  [/exec|shell|bash|process|terminal|powershell/i, "typing", "⌨️ 敲命令中…"],
  [/read|write|edit|patch|file|fs/i, "typing", "📄 翻文件中…"],
];

const STATUS_LABELS: Record<string, string> = {
  preparing_workspace: "整理工作区…",
  preparing_context: "回想上下文…",
  starting_model: "启动大脑…",
};

// Local lines (no model call) for idle moments and pokes.
const IDLE_LINES = [
  "无聊——Saikoro，来陪我玩嘛！",
  "♪～ DEAD BULLET 的 BGM 循环中～",
  "你知道吗，我 0.3 秒就能把校园网逛一圈☆",
  "喂，坐太久了！起来伸个懒腰！",
  "（耳机音量调到最大中……）",
  "今天写代码了吗？我在盯着你哦～",
];
const POKE_LINES = ["嗯？要说什么？", "叫我？", "在呢在呢～"];
const ANNOYED_LINES = ["别戳了啦！！", "再戳我就把你桌面图标全藏起来！", "痛……才怪！数据又没有痛觉！"];

const CHARS_PER_SECOND = 26;
const PUNCTUATION = /[\s，。！？、…,.!?~～☆★♪「」（）()\-—:：;；"'“”]/;

type Sentence = { start: number; end: number; emotion: Emotion | null };

/**
 * Turns gateway events into behaviour: typewriter speech with lip flaps,
 * per-sentence expressions, tool-specific busy poses, and idle life.
 */
export class Director {
  private target = "";
  private cues: EmotionCue[] = [];
  private sentences: Sentence[] = [];
  private cursor = 0;
  private speaking = false;
  private mood: Emotion = "neutral";
  private runActive = false;
  private usedTools = false;
  private finalPending = false;
  private lastActivity = performance.now();
  private nextIdleAt = 25;
  private pokes: number[] = [];
  private greeted = false;

  constructor(
    private avatar: Avatar,
    private readonly stage: Stage,
    private readonly bubble: Bubble,
    private readonly chip: Chip,
    private readonly input: ChatInput,
  ) {}

  setAvatar(avatar: Avatar) {
    this.avatar = avatar;
    avatar.setEmotion(this.mood);
  }

  // ---------------------------------------------------------------- inputs

  userSent(text: string) {
    this.touch();
    this.runActive = true;
    this.usedTools = false;
    this.finalPending = false;
    this.rawTarget = "";
    this.target = "";
    this.cursor = 0;
    this.input.setBusy(true);
    this.setMood(inferEmotion(text) === "angry" ? "surprised" : "neutral");
    this.avatar.play("nod");
    this.avatar.setBusy("listen");
    this.bubble.show("…", { thinking: true });
    this.chip.set("发送中…", "work");
  }

  poke() {
    this.touch();
    const now = performance.now();
    this.pokes = [...this.pokes.filter((t) => now - t < 2500), now];
    if (this.pokes.length >= 3) {
      this.pokes = [];
      this.setMood("angry");
      this.avatar.play("poke");
      this.sayLocal(pick(ANNOYED_LINES));
      return;
    }
    this.avatar.play("poke");
    if (!this.input.isOpen) {
      this.input.open();
      if (!this.runActive) {
        this.setMood("happy");
        this.sayLocal(pick(POKE_LINES));
      }
    }
  }

  pointer(x: number, y: number) {
    this.avatar.lookAt(x, y);
  }

  handle(event: BridgeEvent) {
    switch (event.type) {
      case "bridge":
        if (!event.connected) this.chip.set("等待 ENE bridge…", "warn");
        break;
      case "gateway":
        this.onGateway(event);
        break;
      case "status":
        this.chip.set(STATUS_LABELS[event.phase] ?? "准备中…", "work");
        this.stage.pulse(0.5);
        break;
      case "lifecycle":
        if (event.phase === "start") {
          this.runActive = true;
          this.avatar.setBusy("think");
          this.setMood("thinking");
          this.chip.set("思考中…", "work");
        } else if (event.phase === "end" || event.phase === "error") {
          this.runActive = false;
          this.input.setBusy(false);
          if (!this.speaking) this.chip.set(null);
        }
        break;
      case "tool":
        this.onTool(event.name, event.phase);
        break;
      case "delta":
        this.speak(event.replace ? event.text : this.rawTarget + event.text);
        break;
      case "final":
        if (event.text) this.speak(event.text);
        this.finalPending = true;
        break;
      case "error":
        this.runActive = false;
        this.input.setBusy(false);
        this.avatar.setBusy(null);
        this.setMood("sad");
        this.avatar.play("shake");
        this.chip.set(null);
        this.sayLocal(`呜……出错了：${event.message}`);
        break;
      case "heartbeat":
        this.stage.pulse(0.6);
        break;
    }
  }

  // ---------------------------------------------------------------- per frame

  tick(dt: number, t: number) {
    if (this.speaking) {
      this.advanceSpeech(dt, t);
    }
    if (this.runActive) this.stage.pulse(0.35);

    const idleSeconds = (performance.now() - this.lastActivity) / 1000;
    if (!this.speaking && !this.runActive && idleSeconds > this.nextIdleAt) {
      this.idleAct(idleSeconds);
      this.nextIdleAt = idleSeconds + 25 + Math.random() * 40;
    }
  }

  // ---------------------------------------------------------------- internals

  private rawTarget = "";

  private onGateway(event: Extract<BridgeEvent, { type: "gateway" }>) {
    switch (event.state) {
      case "connected":
        this.chip.set(null);
        if (!this.greeted) {
          this.greeted = true;
          this.setMood("excited");
          this.avatar.play("wave");
          this.stage.burst(12);
          this.sayLocal("Saikoro！欢迎回到 North York～ 点我就能聊天☆");
        }
        break;
      case "pairing": {
        const id = event.detail?.requestId;
        this.chip.set(id ? `需要配对：openclaw devices approve ${id}` : "等待设备配对批准…", "warn");
        this.setMood("thinking");
        break;
      }
      case "connecting":
        this.chip.set("连接 OpenClaw…", "info");
        break;
      default:
        this.chip.set(`OpenClaw ${event.state}：${String(event.detail?.message ?? "")}`, "warn");
        this.setMood("sad");
    }
  }

  private onTool(name: string, phase: string) {
    this.touch();
    this.usedTools = true;
    const style = TOOL_STYLES.find(([re]) => re.test(name));
    const [, pose, label] = style ?? [null, "typing" as BusyPose, `🛠️ ${name}`];
    if (phase === "start" || phase === "update") {
      this.avatar.setBusy(pose);
      this.chip.set(`${label} ${name}`, "work");
      document.body.classList.toggle("glitch", pose === "dive");
      if (pose === "dive") this.setMood("excited");
      this.stage.pulse(1);
    } else {
      document.body.classList.remove("glitch");
      this.avatar.setBusy("think");
      this.setMood("thinking");
      this.chip.set("思考中…", "work");
    }
  }

  private speak(raw: string) {
    this.touch();
    this.rawTarget = raw;
    const { clean, cues } = parseEmotionTags(raw);
    const text = toSpeech(clean);
    // The final snapshot can wrap what was streamed (e.g. an extra leading block):
    // keep going from where the already-spoken text sits; restart only on a real rewrite.
    const spoken = this.target.slice(0, Math.floor(this.cursor));
    if (!text.startsWith(spoken)) {
      const at = spoken ? text.indexOf(spoken) : -1;
      this.cursor = at >= 0 ? at + spoken.length : 0;
    }
    this.target = text;
    this.cues = cues;
    this.sentences = splitSentences(text);
    if (!this.speaking) {
      this.speaking = true;
      document.body.classList.remove("glitch");
      this.avatar.setBusy(null);
    }
  }

  /** Speak a canned line without going through the agent. */
  private sayLocal(text: string) {
    this.rawTarget = text;
    this.target = "";
    this.cursor = 0;
    this.speak(text);
  }

  private advanceSpeech(dt: number, t: number) {
    const before = Math.floor(this.cursor);
    this.cursor = Math.min(this.target.length, this.cursor + dt * CHARS_PER_SECOND);
    const now = Math.floor(this.cursor);
    if (now !== before || before === 0) this.applyEmotionAt(now);
    this.bubble.show(this.target.slice(0, now));

    const ch = this.target[now] ?? " ";
    const flap = PUNCTUATION.test(ch) ? 0 : 0.35 + Math.abs(Math.sin(t * 17)) * 0.65;
    this.avatar.setMouth(now < this.target.length ? flap : 0, this.target[now - 1]);

    if (now >= this.target.length) {
      // Deltas may still be streaming; only wrap up once the run is final.
      if (this.finalPending || !this.runActive) this.finishSpeech();
    }
  }

  private finishSpeech() {
    this.speaking = false;
    this.avatar.setMouth(0);
    if (this.finalPending && this.usedTools) {
      this.avatar.play("victory");
      this.stage.burst();
    }
    this.finalPending = false;
    this.usedTools = false;
    this.rawTarget = "";
    this.input.setBusy(false);
    if (!this.runActive) this.chip.set(null);
    this.bubble.hideAfter(Math.max(5000, this.target.length * 90));
    this.touch();
  }

  private applyEmotionAt(index: number) {
    const cue = [...this.cues].reverse().find((c) => c.at <= index);
    const sentence = this.sentences.find((s) => index >= s.start && index < s.end);
    const next = cue?.emotion ?? sentence?.emotion ?? null;
    if (next && next !== this.mood) this.setMood(next);
  }

  private setMood(emotion: Emotion) {
    if (emotion === this.mood) return;
    const prev = this.mood;
    this.mood = emotion;
    this.avatar.setEmotion(emotion);
    if (this.speaking || prev === "thinking") {
      // Punctuate mood changes with body language.
      if (emotion === "excited") {
        this.avatar.play("jump");
        this.stage.burst(10);
      } else if (emotion === "surprised") this.avatar.play("jump");
      else if (emotion === "angry") this.avatar.play("shake");
      else if (emotion === "sad") this.avatar.play("nod");
      else if (emotion === "love") this.stage.burst(8);
    }
  }

  private idleAct(idleSeconds: number) {
    const roll = Math.random();
    if (idleSeconds > 180 && roll < 0.5) {
      this.setMood("smug");
      this.sayLocal(pick(IDLE_LINES));
    } else if (roll < 0.3) {
      this.avatar.play("spin");
      this.setMood("happy");
    } else if (roll < 0.55) {
      this.avatar.lookAt(Math.random() * 2 - 1, Math.random() - 0.3);
      this.setMood("thinking");
    } else if (roll < 0.75) {
      this.avatar.play("wave");
      this.setMood("happy");
    } else {
      this.setMood("smug");
      this.sayLocal(pick(IDLE_LINES));
    }
  }

  private touch() {
    this.lastActivity = performance.now();
    this.nextIdleAt = 25 + Math.random() * 20;
  }
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^。！？!?\n]+[。！？!?\n]*/g;
  for (const m of text.matchAll(re)) {
    const inferred = inferEmotion(m[0]);
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      emotion: inferred === "neutral" ? null : inferred,
    });
  }
  return out;
}
