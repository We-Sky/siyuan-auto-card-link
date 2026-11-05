import {afterEach, describe, it, expect, vi} from "vitest";
import {fetchCard} from "../src/network";
afterEach(() => vi.unstubAllGlobals());
describe("metadata requests", () => {
  it("uses the SiYuan proxy and decodes base64", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ok:true, json: async () => ({code:0,data:{status:200,contentType:"text/html; charset=utf-8",bodyEncoding:"base64",body:Buffer.from('<title>中文标题</title>').toString("base64")}})});
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchCard("https://example.com")).title).toBe("中文标题");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/network/forwardProxy");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).responseEncoding).toBe("base64");
  });
  it.each([403, 429, 500])("retains URL on HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json: async () => ({code:0,data:{status,body:"denied"}})}));
    const card = await fetchCard("https://example.com/original");
    expect(card.url).toBe("https://example.com/original"); expect(card.fetched).toBe(false);
  });
  it("settles a hung request and preserves the original URL", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("abort"))))));
    const pending = fetchCard("https://example.com", 2000);
    await vi.advanceTimersByTimeAsync(2501);
    expect((await pending).fetched).toBe(false);
    vi.useRealTimers();
  });
});
