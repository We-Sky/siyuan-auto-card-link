import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import AutoCardLink from "../src/index";
import {readCard} from "../src/core";
function focus(html = "", type = "NodeParagraph") {
  document.body.innerHTML = `<div data-type="${type}"><div contenteditable="true">${html}</div></div>`;
  const editable = document.querySelector('[contenteditable="true"]')!;
  const range = document.createRange(); range.selectNodeContents(editable); range.collapse(false);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
}
function paste(plugin: AutoCardLink, extra = {}) {
  const resolve = vi.fn();
  const event = new CustomEvent("paste", {cancelable:true, detail:{textPlain:"https://example.com/post",textHTML:"",siyuanHTML:"",protyle:{},resolve,...extra}});
  (plugin as any).onPaste(event);
  return {event,resolve};
}
beforeEach(() => { focus(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); });
afterEach(() => vi.unstubAllGlobals());
describe("paste integration", () => {
  it("resolves intercepted paste exactly once with a usable fallback card", async () => {
    const plugin = new AutoCardLink({} as any);
    await plugin.onload();
    const {event,resolve} = paste(plugin);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    const doc = new DOMParser().parseFromString(resolve.mock.calls[0][0].textHTML,"text/html");
    expect(readCard(doc.querySelector("iframe")!.src)?.url).toBe("https://example.com/post");
  });
  it.each(["NodeCodeBlock", "NodeTable", "NodeWidget"])("leaves %s untouched", async type => {
    const plugin = new AutoCardLink({} as any); await plugin.onload(); focus("",type);
    expect(paste(plugin).event.defaultPrevented).toBe(false);
  });
  it("does not replace text, files, copied blocks, images or selected text", async () => {
    const plugin = new AutoCardLink({} as any); await plugin.onload();
    focus("Writing a sentence "); expect(paste(plugin).event.defaultPrevented).toBe(false);
    focus(); expect(paste(plugin,{files:{length:1}}).event.defaultPrevented).toBe(false);
    expect(paste(plugin,{siyuanHTML:"copied block"}).event.defaultPrevented).toBe(false);
    expect(paste(plugin,{textPlain:"https://example.com/photo.png"}).event.defaultPrevented).toBe(false);
    focus("selected"); const range = document.createRange(); range.selectNodeContents(document.querySelector('[contenteditable="true"]')!); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    expect(paste(plugin).event.defaultPrevented).toBe(false);
  });
  it("unregisters listeners on unload and restores pending plain paste", async () => {
    const plugin = new AutoCardLink({} as any); await plugin.onload();
    const off = vi.spyOn(plugin.eventBus,"off"); const {resolve} = paste(plugin); plugin.onunload();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    expect(resolve.mock.calls[0][0].textPlain).toBe("https://example.com/post"); expect(off).toHaveBeenCalledTimes(2);
  });
});
