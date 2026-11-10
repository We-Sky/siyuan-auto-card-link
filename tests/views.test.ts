import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {cardHTML, fallbackCard, linkCacheAttribute, readCard} from "../src/core";
import {ViewSwitcher} from "../src/views";

const url = "https://example.com/story";
let switcher: ViewSwitcher;
const fetchCard = vi.fn(async (address: string) => ({
  ...fallbackCard(address), title: "网页标题", description: "网页摘要", image: "assets/cover.jpg",
}));
const request = vi.fn(async (_path: string, _options: RequestInit) =>
  ({ok: true, json: async () => ({code: 0})}));

beforeEach(() => {
  document.body.innerHTML = '<div class="protyle-wysiwyg" contenteditable="true"></div>';
  vi.clearAllMocks();
  vi.stubGlobal("fetch", request);
  switcher = new ViewSwitcher(fetchCard, vi.fn());
});

afterEach(() => {
  switcher.destroy();
  vi.unstubAllGlobals();
});

function block(type: string, html: string) {
  const node = document.createElement("div");
  node.dataset.nodeId = "20261110120000-abcd123";
  node.dataset.type = type;
  node.innerHTML = html;
  document.querySelector(".protyle-wysiwyg")!.append(node);
  return node;
}

function savedMarkdown() {
  return JSON.parse(String(request.mock.calls.at(-1)?.[1].body)).data as string;
}

function savedCard(markdown: string) {
  const doc = new DOMParser().parseFromString(markdown, "text/html");
  return readCard(doc.querySelector("iframe")!.getAttribute("src")!);
}

describe("switching note link views", () => {
  it("offers copy and both views on a standalone link and can convert it to a card", async () => {
    const node = block("NodeParagraph", `<div contenteditable="true"><span data-type="a" data-href="${url}">原链接</span></div>`);
    node.querySelector("span")!.dispatchEvent(new MouseEvent("pointerover", {bubbles: true}));
    const menu = document.querySelector<HTMLElement>(".siyuan-cardlink-views")!;
    expect(menu.hidden).toBe(false);
    expect(Array.from(menu.querySelectorAll("button"), button => button.textContent)).toEqual(["链接视图", "卡片视图", "复制链接"]);
    const choice = Array.from(menu.querySelectorAll("button")).find(button => button.textContent === "卡片视图")!;
    choice.click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(savedCard(savedMarkdown())).toMatchObject({url, linkText: "原链接"});
    expect(savedMarkdown()).toContain("height: 156px");
  });

  it("copies the destination of a hovered card", async () => {
    const node = block("NodeWidget", cardHTML({...fallbackCard(url), title: "卡片标题"}));
    const frame = node.querySelector("iframe")!;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
    try {
      window.dispatchEvent(new MessageEvent("message", {
        origin: location.origin, source: frame.contentWindow,
        data: {type: "siyuan-cardlink-hover", active: true},
      }));
      const buttons = document.querySelectorAll<HTMLButtonElement>(".siyuan-cardlink-views button");
      Array.from(buttons).find(button => button.textContent === "复制链接")!.click();
      expect(writeText).toHaveBeenCalledWith(url);
      expect(request).not.toHaveBeenCalled();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("protects text in paragraphs containing inline links", async () => {
    const node = block("NodeParagraph", `<div contenteditable="true">正文 <span data-type="a" data-href="${url}">原链接</span></div>`);
    const link = node.querySelector("span")!;
    link.dispatchEvent(new MouseEvent("pointerover", {bubbles: true}));
    expect(document.querySelector<HTMLElement>(".siyuan-cardlink-views")!.hidden).toBe(true);
    await switcher.update(node, "card", link);
    expect(request).not.toHaveBeenCalled();
  });

  it("restores native linked text and reuses the cover when converting back", async () => {
    const node = block("NodeWidget", cardHTML({...fallbackCard(url), compact: true, image: "assets/cover.jpg", linkText: "原[链接]"}));
    await switcher.update(node, "link", node.querySelector("iframe")!);
    const linkMarkdown = savedMarkdown();
    expect(linkMarkdown.split("\n")[0]).toBe(`[原\\[链接\\]](<${url}>)`);
    expect(linkMarkdown).not.toContain("<iframe");
    const cache = linkMarkdown.match(/custom-cardlink-data="([^"]+)"/)![1];
    node.dataset.type = "NodeParagraph";
    node.setAttribute(linkCacheAttribute, cache);
    node.innerHTML = `<div contenteditable="true"><span data-type="a" data-href="${url}">原[链接]</span></div>`;
    await switcher.update(node, "card", node.querySelector("span")!);
    expect(savedMarkdown()).toContain('custom-data-assets="assets/cover.jpg"');
    expect(savedCard(savedMarkdown())).toMatchObject({compact: true, image: "assets/cover.jpg", linkText: "原[链接]"});
    expect(fetchCard).not.toHaveBeenCalled();
  });
});
