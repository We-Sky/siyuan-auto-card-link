import {afterEach, describe, it, expect, vi} from "vitest";
import {Blob as NodeBlob} from "node:buffer";
import {webcrypto} from "node:crypto";
import {cardMarkdown, fallbackCard, imagePath, metadata, normalizeCard} from "../src/core";
import {cacheCover, coverBlob, fetchCard} from "../src/network";

afterEach(() => vi.unstubAllGlobals());
function response(data: unknown) { return {ok:true,json:async()=>({code:0,data})}; }
function proxyResult(body: string, contentType="text/html", status=200) { return {status,contentType,body,bodyEncoding:"text"}; }

describe("cover extraction", () => {
  it("extracts JSON-LD article images, including graph/object/array forms", () => {
    const card = metadata('<title>Article</title><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","headline":"News","image":[{"@type":"ImageObject","url":"/news.jpg"}]}]}</script>',"https://example.com/story");
    expect(card.image).toBe("https://example.com/news.jpg"); expect(card.title).toBe("News");
  });
  it("finds article lazy images and skips tracking pixels, avatars and data placeholders", () => {
    const card = metadata('<article><img src="/avatar.png"><img width="1" height="1" src="/pixel.gif"><img src="data:image/gif;base64,eA==" data-src="/real-cover.webp"></article>',"https://example.com/story");
    expect(card.image).toBe("https://example.com/real-cover.webp");
  });
  it("does not mistake a site's unrelated navigation image for an article cover", () => {
    expect(metadata('<nav><img src="/banner.jpg"></nav>',"https://example.com/story").image).toBe("");
  });
  it("extracts Bilibili initial state without evaluating script", () => {
    const card = metadata('<script>window.__INITIAL_STATE__={"videoData":{"bvid":"BV17x411w7KC","pic":"//i2.hdslb.com/cover.jpg","title":"Video","desc":"Summary"}};throw new Error("must not run");</script>',"https://www.bilibili.com/video/BV17x411w7KC");
    expect(card.image).toBe("https://i2.hdslb.com/cover.jpg"); expect(card.title).toBe("Video");
  });
  it("matches Douyin RENDER_DATA to the requested video, not recommended videos", () => {
    const data={items:[{aweme_id:"999",desc:"Wrong",video:{cover:{url_list:["https://cdn.example.com/wrong.jpg"]}}},{aweme_id:"123",desc:"Right",video:{origin_cover:{url_list:["https://cdn.example.com/right.jpg"]}}}]};
    const card=metadata(`<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(data))}</script>`,"https://www.douyin.com/video/123");
    expect(card.image).toBe("https://cdn.example.com/right.jpg"); expect(card.title).toBe("Right");
  });
  it("retains OG image precedence", () => {
    expect(metadata('<meta property="og:image" content="/og.jpg"><article><img src="/body.jpg"></article>',"https://example.com").image).toBe("https://example.com/og.jpg");
  });
  it("roundtrips local image references and rejects traversal", () => {
    const card=normalizeCard({...fallbackCard("https://example.com"),image:"assets/cardlink-abc-20261105.jpg",imageStatus:"cached",remoteImages:false});
    expect(card.image).toBe("assets/cardlink-abc-20261105.jpg");
    expect(cardMarkdown(card)).toContain('custom-data-assets="assets/cardlink-abc-20261105.jpg"');
    expect(imagePath("assets/../conf/conf.json")).toBe(""); expect(imagePath("assets/%2e%2e/x")).toBe("");
  });
});

describe("platform requests and cover downloading", () => {
  it("uses Bilibili's video API when the ordinary page would be blocked", async () => {
    const fetchMock=vi.fn().mockResolvedValue(response(proxyResult(JSON.stringify({code:0,data:{bvid:"BV17x411w7KC",title:"Video title",pic:"https://i2.hdslb.com/cover.jpg",desc:"Desc"}}),"application/json")));
    vi.stubGlobal("fetch",fetchMock);
    const card=await fetchCard("https://www.bilibili.com/video/BV17x411w7KC/");
    expect(card.image).toBe("https://i2.hdslb.com/cover.jpg"); expect(card.site).toBe("哔哩哔哩");
    const request=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.url).toContain("/x/web-interface/view?bvid=BV17x411w7KC"); expect(request.headers[0].Referer).toBe("https://www.bilibili.com/");
  });
  it("resolves b23 share redirects before extracting the video", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(response({...proxyResult("","text/html",302),headers:{Location:["https://www.bilibili.com/video/BV17x411w7KC/"]}})).mockResolvedValueOnce(response(proxyResult(JSON.stringify({code:0,data:{title:"Short link",pic:"https://cdn.example.com/c.jpg"}}),"application/json"))));
    const card=await fetchCard("https://b23.tv/example"); expect(card.url).toBe("https://b23.tv/example"); expect(card.image).toBe("https://cdn.example.com/c.jpg");
  });
  it("marks a missing cover instead of inventing an image",async()=>{
    expect((await cacheCover(fallbackCard("https://example.com"))).imageStatus).toBe("missing");
  });
  it("rejects an HTML challenge disguised as an image",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(proxyResult("<html>verify</html>","image/jpeg"))));
    await expect(coverBlob("https://cdn.example.com/x.jpg","https://example.com")).rejects.toThrow("不是支持的图片");
  });
  it("downloads with the source Referer and uploads a validated image as a local attachment",async()=>{
    vi.stubGlobal("Blob",NodeBlob); vi.stubGlobal("crypto",webcrypto);
    vi.stubGlobal("FormData",class {
      values=new Map();
      append(key:string,value:any,filename?:string){this.values.set(key,filename?{name:filename,blob:value}:value);}
      get(key:string){return this.values.get(key);}
    });
    const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
    const fetchMock=vi.fn(async(path:string,options:any)=>{
      if(path==="/api/network/forwardProxy")return response({status:200,body:png.toString("base64"),bodyEncoding:"base64",contentType:"image/png"});
      const file=options.body.get("file[]");
      return response({succMap:{[file.name]:"assets/saved-cover-20261105.png"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const card=await cacheCover({...fallbackCard("https://www.bilibili.com/video/BV17x411w7KC/"),image:"https://i2.hdslb.com/cover.png"});
    expect(card.image).toBe("assets/saved-cover-20261105.png"); expect(card.imageStatus).toBe("cached"); expect(card.imageSource).toBe("https://i2.hdslb.com/cover.png");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).headers[0].Referer).toContain("bilibili.com/video");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/asset/upload");
  });
  it("keeps the remote source when a download or upload fails",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
    const card=await cacheCover({...fallbackCard("https://example.com"),image:"https://cdn.example.com/a.jpg"});
    expect(card.imageStatus).toBe("remote"); expect(card.image).toBe("https://cdn.example.com/a.jpg");
  });
});
