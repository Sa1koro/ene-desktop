export const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "smug",
  "angry",
  "surprised",
  "sad",
  "thinking",
  "shy",
  "love",
] as const;

export type Emotion = (typeof EMOTIONS)[number];

// Tags ENE may write inline, e.g. "[smug] 又熬夜了？" — aliases keep the prompt forgiving.
const TAG_ALIASES: Record<string, Emotion> = {
  neutral: "neutral",
  calm: "neutral",
  happy: "happy",
  joy: "happy",
  smile: "happy",
  excited: "excited",
  grin: "smug",
  smug: "smug",
  tease: "smug",
  angry: "angry",
  pout: "angry",
  mad: "angry",
  surprised: "surprised",
  shock: "surprised",
  sad: "sad",
  cry: "sad",
  thinking: "thinking",
  think: "thinking",
  shy: "shy",
  blush: "shy",
  embarrassed: "shy",
  love: "love",
  heart: "love",
  adore: "love",
};

const TAG_RE = /[[【]\s*([a-z]+)\s*[\]】]/gi;

export type EmotionCue = { at: number; emotion: Emotion };

/** Strips emotion tags and returns where in the clean text each emotion starts. */
export function parseEmotionTags(text: string): { clean: string; cues: EmotionCue[] } {
  const cues: EmotionCue[] = [];
  let clean = "";
  let last = 0;
  for (const match of text.matchAll(TAG_RE)) {
    const emotion = TAG_ALIASES[match[1].toLowerCase()];
    if (!emotion) continue;
    clean += text.slice(last, match.index);
    cues.push({ at: clean.length, emotion });
    last = match.index + match[0].length;
  }
  clean += text.slice(last);
  return { clean: clean.replace(/^\s+/, ""), cues };
}

// Fallback when ENE didn't tag her line: guess from emoji, kaomoji and verbal tics.
const HEURISTICS: Array<[RegExp, Emotion]> = [
  [/😠|💢|😤|笨蛋|バカ|baka|哼[！!]|可恶|气死/i, "angry"],
  [/😢|😭|🥺|呜+|抱歉|对不起|sorry|ごめん|失败/i, "sad"],
  [/❤|♥|💕|💖|😍|🥰|喜欢你|最喜欢|爱你|大好き/i, "love"],
  [/😳|☺|害羞|不好意思|脸红|照れ|恥ずかし|\/\/\//i, "shy"],
  [/[!！][?？]|[?？][!！]|欸|诶|えっ|什么[?？！!]|\bwhat\b|😲|😮/i, "surprised"],
  [/😏|😼|\bhehe\b|嘿嘿|哼哼|～$|呢～|ふふ|就知道/i, "smug"],
  [/☆|★|✨|🎉|太棒|好耶|やった|\byay\b|哈哈哈|www/i, "excited"],
  [/😊|😄|😆|♪|哈哈|嘻嘻|开心|\blol\b|😁/i, "happy"],
  [/🤔|让我想想|嗯[…\.]{2,}|let me think|考えて/i, "thinking"],
];

export function inferEmotion(text: string): Emotion {
  for (const [re, emotion] of HEURISTICS) if (re.test(text)) return emotion;
  return "neutral";
}

/** Removes markdown noise so speech bubbles read like speech. */
export function toSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "（代码略）")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, "$1$2")
    .replace(/^\s*[-*]\s+/gm, "· ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
