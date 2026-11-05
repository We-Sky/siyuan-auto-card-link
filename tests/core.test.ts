import {describe, it, expect} from "vitest";
import {cardHTML, fallbackCard, metadata, normalizeCard, readCard, singleURL, webURL} from "../src/core";

describe("URL and durable card data", () => {
  it.each(["javascript:alert(1)", "data:text/html,test", "file:///test", "https://user:pass@example.com", "not a url"])("rejects unsafe URL %s", value => expect(webURL(value)).toBe(""));
  it("leaves multi-line and image paste alone", () => {
    expect(singleURL("https://a.com\nhttps://b.com")).toBe("");
    expect(singleURL("https://example.com/a.JPG?width=200")).toBe("");
    expect(singleURL(" https://example.com/中文 ")).toBe("https://example.com/%E4%B8%AD%E6%96%87");
  });
  it("roundtrips quotes, Chinese, newlines and markup without HTML injection", () => {
    const card = {...fallbackCard("https://example.com/?a=1&b=2"), title: '中文 " <script>alert(1)</script>', description: "摘要\n第二行", image: "https://example.com/a.png", compact: true};
    const doc = new DOMParser().parseFromString(cardHTML(card), "text/html");
    expect(doc.querySelectorAll("iframe")).toHaveLength(1);
    expect(doc.querySelector("script")).toBeNull();
    const restored = readCard(doc.querySelector("iframe")!.src)!;
    expect(restored.title).toBe(card.title);
    expect(restored.description).toBe("摘要 第二行");
    expect(restored.compact).toBe(true);
  });
  it("rejects unrelated widgets, malformed data and unsafe images", () => {
    expect(readCard("https://example.com/widget#{}")).toBeNull();
    expect(readCard("/plugins/siyuan-auto-card-link/card.html#%xx")).toBeNull();
    expect(normalizeCard({...fallbackCard("https://example.com"), image: "javascript:alert(1)"}).image).toBe("");
  });
});

describe("metadata extraction", () => {
  it("prioritizes OG and resolves relative assets with base URLs", () => {
    const card = metadata('<base href="https://cdn.example.org/posts/"><title>Fallback</title><meta content="OG &amp; 中文" property="og:title"><meta name="twitter:title" content="Twitter"><meta property="og:image" content="../cover.jpg"><meta name="description" content="Summary"><link href="/icon.png" rel="shortcut icon">', "https://example.com/post");
    expect(card.title).toBe("OG & 中文");
    expect(card.image).toBe("https://cdn.example.org/cover.jpg");
    expect(card.favicon).toBe("https://cdn.example.org/icon.png");
    expect(card.description).toBe("Summary");
    expect(card.fetched).toBe(true);
  });
  it("uses Twitter and HTML fallback", () => {
    expect(metadata('<meta name="twitter:title" content="Tweet">', "https://example.com").title).toBe("Tweet");
    expect(metadata('<title>HTML title</title>', "https://example.com").title).toBe("HTML title");
  });
  it("does not accept challenges as successful previews", () => {
    expect(metadata('<title>Just a moment...</title>', "https://example.com").fetched).toBe(false);
    expect(metadata('<html><body>No metadata</body></html>', "https://example.com").fetched).toBe(false);
  });
});
