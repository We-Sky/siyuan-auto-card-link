import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import AutoCardLink from "../src/index";
import {cardHTML, fallbackCard, readCard} from "../src/core";
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

describe("refresh existing covers", () => {
  it("keeps user-edited text and references the downloaded attachment", async () => {
    const plugin = new AutoCardLink({} as any); await plugin.onload();
    const old = {...fallbackCard("https://example.com/post"), title: "My edited title", description: "My edited summary", image:"https://example.com/old.jpg"};
    const block=document.createElement("div"); block.dataset.nodeId="20261105100000-abcdefg"; block.innerHTML=cardHTML(old);
    (plugin as any).makeCard=vi.fn().mockResolvedValue({...old,title:"Remote title",description:"Remote summary",image:"assets/new-cover.jpg",imageStatus:"cached"});
    const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({code:0,data:[]})});vi.stubGlobal("fetch",fetchMock);
    const items:any[]=[];
    (plugin as any).onBlockMenu({detail:{blockElements:[block],menu:{addItem:(item:any)=>items.push(item)}}});
    items.find(item=>item.label==="重新获取封面").click();
    await vi.waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));
    const saved=JSON.parse(fetchMock.mock.calls[0][1].body).data;
    const iframe=new DOMParser().parseFromString(saved,"text/html").querySelector("iframe")!;
    expect(readCard(iframe.src)?.title).toBe("My edited title");expect(readCard(iframe.src)?.description).toBe("My edited summary");
    expect(saved).toContain('custom-data-assets="assets/new-cover.jpg"');
  });
  it("does not overwrite an existing card when no new cover can be obtained", async () => {
    const plugin=new AutoCardLink({} as any);await plugin.onload();
    const old={...fallbackCard("https://example.com/post"),image:"https://example.com/old.jpg"};
    const block=document.createElement("div");block.dataset.nodeId="20261105100000-abcdefg";block.innerHTML=cardHTML(old);
    (plugin as any).makeCard=vi.fn().mockResolvedValue(fallbackCard(old.url));
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    const items:any[]=[];(plugin as any).onBlockMenu({detail:{blockElements:[block],menu:{addItem:(item:any)=>items.push(item)}}});
    items.find(item=>item.label==="重新获取封面").click();
    await Promise.resolve();await Promise.resolve();expect(fetchMock).not.toHaveBeenCalled();
  });
});
