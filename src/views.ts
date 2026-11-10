import {cardMarkdown, linkCacheAttribute, linkMarkdown, readCard, readLinkCache, singleURL, views, type CardData, type CardView} from "./core";
import {api} from "./network";

const nativeLinkSelector = 'a[href], span[data-type="a"][data-href]';
const editorSelector = '.protyle-wysiwyg[contenteditable="true"]:not([data-readonly="true"])';
const stripCaret = (text: string) => text.replace(/[\u200b\ufeff]/g, "").trim();

function nativeLink(block: HTMLElement, link: Element) {
  const content = link.parentElement;
  if (block.dataset.type !== "NodeParagraph" || content?.parentElement !== block ||
      !content.matches('[contenteditable="true"]') || content.children.length !== 1 || link.children.length) return null;
  if (Array.from(content.childNodes).some(node => node !== link && stripCaret(node.textContent || ""))) return null;
  const url = singleURL(link.getAttribute("data-href") || link.getAttribute("href") || "");
  return url ? {url, text: stripCaret(link.textContent || "")} : null;
}

export class ViewSwitcher {
  private readonly listeners = new AbortController();
  private readonly menu = document.createElement("div");
  private readonly pending = new Set<string>();
  private anchor?: Element;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly fetchCard: (url: string) => Promise<CardData>, private readonly report: (message: string) => void) {
    const {signal} = this.listeners;
    this.menu.className = "siyuan-cardlink-views";
    this.menu.hidden = true;
    this.menu.setAttribute("role", "group");
    this.menu.setAttribute("aria-label", "链接工具");
    document.body.append(this.menu);
    this.menu.addEventListener("pointerenter", () => clearTimeout(this.timer), {signal});
    this.menu.addEventListener("pointerleave", () => this.dismissSoon(), {signal});
    this.menu.addEventListener("focusin", () => clearTimeout(this.timer), {signal});
    this.menu.addEventListener("focusout", event => {
      if (!(event.relatedTarget instanceof Node) || !this.menu.contains(event.relatedTarget)) this.dismissSoon();
    }, {signal});
    document.addEventListener("pointerover", this.onNativeEnter, {signal});
    document.addEventListener("focusin", this.onNativeEnter, {signal});
    document.addEventListener("pointerout", this.onNativeLeave, {signal});
    document.addEventListener("focusout", this.onNativeLeave, {signal});
    document.addEventListener("scroll", () => this.hide(), {signal, capture: true});
    document.addEventListener("keydown", event => { if (event.key === "Escape") this.hide(); }, {signal});
    window.addEventListener("resize", () => this.hide(), {signal});
    window.addEventListener("message", this.onFrameHover, {signal});
  }

  destroy() {
    this.listeners.abort();
    this.hide();
    this.menu.remove();
  }

  async copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      this.report("链接已复制");
    } catch {
      this.report("复制失败，请手动复制网址");
    }
  }

  async update(block: HTMLElement, view: CardView, source: Element) {
    const id = block.dataset.nodeId;
    if (!id || !block.isConnected || !block.closest(editorSelector) || this.pending.has(id)) return;
    this.pending.add(id);
    try {
      const saved = source instanceof HTMLIFrameElement ? source.getAttribute("src") || source.getAttribute("data-src") : null;
      let card = saved ? readCard(saved) : null;
      if (card) {
        if (view !== "link") return;
      } else {
        const initial = nativeLink(block, source);
        if (!initial || view !== "card") return;
        card = readLinkCache(block.getAttribute(linkCacheAttribute) || "", initial.url);
        if (!card) {
          this.report("正在生成链接卡片…");
          card = await this.fetchCard(initial.url);
        }
        const current = nativeLink(block, source);
        if (current?.url !== initial.url || current.text !== initial.text) return;
        card.linkText = initial.text;
      }
      if (this.listeners.signal.aborted ||
          !source.isConnected || source.closest("[data-node-id]") !== block || !block.closest(editorSelector)) return;
      const markdown = view === "link" ? linkMarkdown(card) : cardMarkdown(card);
      await api("/api/block/updateBlock", {id, dataType: "markdown", data: markdown});
    } catch (error) {
      this.report(error instanceof Error ? error.message : "切换视图失败");
    } finally {
      this.pending.delete(id);
    }
  }

  private onNativeEnter = (event: Event) => {
    const link = event.target instanceof Element ? event.target.closest(nativeLinkSelector) : null;
    const block = link?.closest<HTMLElement>("[data-node-id]");
    if (!link || !block?.closest(editorSelector)) return;
    const data = nativeLink(block, link);
    if (data) this.show(link, block, "link", data.url);
  };

  private onNativeLeave = (event: MouseEvent | FocusEvent) => {
    if (!(event.target instanceof Node) || !this.anchor?.contains(event.target)) return;
    if (event.relatedTarget instanceof Node && this.anchor.contains(event.relatedTarget)) return;
    this.dismissSoon();
  };

  private onFrameHover = (event: MessageEvent) => {
    if (event.origin !== location.origin || !event.source ||
        event.data?.type !== "siyuan-cardlink-hover" || typeof event.data.active !== "boolean") return;
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>(editorSelector + " iframe"))
      .find(candidate => candidate.contentWindow === event.source);
    if (!frame?.src.startsWith(location.origin + "/")) return;
    const data = readCard(frame.src);
    const block = frame.closest<HTMLElement>('[data-type="NodeWidget"][data-node-id]');
    if (!data || !block) return;
    if (event.data.active) this.show(frame, block, "card", data.url);
    else if (this.anchor === frame) this.dismissSoon();
  };

  private show(anchor: Element, block: HTMLElement, current: CardView, url: string) {
    clearTimeout(this.timer);
    if (this.anchor === anchor && !this.menu.hidden) return;
    this.anchor = anchor;
    this.menu.replaceChildren();
    for (const view of Object.keys(views) as CardView[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = views[view];
      button.setAttribute("aria-pressed", String(current === view));
      button.disabled = current === view;
      button.addEventListener("click", () => {
        this.hide();
        void this.update(block, view, anchor);
      });
      this.menu.append(button);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制链接";
    copy.addEventListener("click", () => { void this.copyLink(url); });
    this.menu.append(copy);
    this.menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const width = this.menu.offsetWidth;
    const height = this.menu.offsetHeight;
    const top = rect.top >= height + 4 ? rect.top - height - 4 : rect.top + 4;
    this.menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)) + "px";
    this.menu.style.top = Math.max(4, Math.min(top, window.innerHeight - height - 4)) + "px";
  }

  private dismissSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.menu.matches(":hover") && !this.menu.contains(document.activeElement)) this.hide(); }, 220);
  }

  private hide() {
    clearTimeout(this.timer);
    this.anchor = undefined;
    this.menu.hidden = true;
  }
}
