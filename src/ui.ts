// DOM overlay: speech bubble, activity chip, chat input and context menu.

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export class Bubble {
  private readonly el = $("#bubble");
  private readonly text = $("#bubble-text");
  private hideTimer = 0;

  show(text: string, opts: { thinking?: boolean } = {}) {
    window.clearTimeout(this.hideTimer);
    this.el.classList.toggle("thinking", !!opts.thinking);
    this.el.classList.add("visible");
    this.text.textContent = text;
    this.text.scrollTop = this.text.scrollHeight;
  }

  hideAfter(ms: number) {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.el.classList.remove("visible"), ms);
  }

  hide() {
    window.clearTimeout(this.hideTimer);
    this.el.classList.remove("visible");
  }
}

export type ChipKind = "info" | "work" | "warn";

export class Chip {
  private readonly el = $("#chip");

  set(text: string | null, kind: ChipKind = "info") {
    if (!text) {
      this.el.classList.remove("visible");
      return;
    }
    this.el.textContent = text;
    this.el.dataset.kind = kind;
    this.el.classList.add("visible");
  }
}

export class ChatInput {
  private readonly bar = $("#input-bar");
  private readonly input = $<HTMLInputElement>("#input");

  constructor(onSubmit: (text: string) => void, onStop: () => void) {
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        const text = this.input.value.trim();
        if (text) {
          onSubmit(text);
          this.input.value = "";
        }
      } else if (e.key === "Escape") {
        this.close();
      }
    });
    $("#send").addEventListener("click", () => {
      const text = this.input.value.trim();
      if (text) {
        onSubmit(text);
        this.input.value = "";
      }
    });
    $("#stop").addEventListener("click", onStop);
  }

  get isOpen() {
    return this.bar.classList.contains("visible");
  }

  open() {
    this.bar.classList.add("visible");
    this.input.focus();
  }

  close() {
    this.bar.classList.remove("visible");
    this.input.blur();
  }

  setBusy(busy: boolean) {
    this.bar.classList.toggle("busy", busy);
  }
}

export type MenuItem = { label: string; action: () => void };

export class ContextMenu {
  private readonly el = $("#menu");

  constructor(items: () => MenuItem[]) {
    window.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.el.replaceChildren(
        ...items().map((item) => {
          const btn = document.createElement("button");
          btn.textContent = item.label;
          btn.onclick = () => {
            this.close();
            item.action();
          };
          return btn;
        }),
      );
      this.el.style.left = `${Math.min(e.clientX, window.innerWidth - 170)}px`;
      this.el.style.top = `${Math.min(e.clientY, window.innerHeight - 140)}px`;
      this.el.classList.add("visible");
    });
    window.addEventListener("pointerdown", (e) => {
      if (!this.el.contains(e.target as Node)) this.close();
    });
  }

  close() {
    this.el.classList.remove("visible");
  }
}
