import {fallbackCard, metadata, normalizeCard, webURL, type CardData} from "./core";
import {platformPreview} from "./extract";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
type ProxyResult = {status: number; body: string; bodyEncoding?: string; contentType?: string; headers?: Record<string, string[] | string>};
export async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), signal});
  if (!response.ok) throw new Error(`思源接口请求失败 (${response.status})`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "思源接口请求失败");
  return result.data as T;
}

async function proxy(url: string, timeout: number, referer = url, redirect = true): Promise<ProxyResult> {
  if (!webURL(url)) throw new Error("无效网址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout + 500);
  try {
    return await api<ProxyResult>("/api/network/forwardProxy", {url, method: "GET", timeout, redirect,
      headers: [{"User-Agent": USER_AGENT, Referer: referer, Accept: "text/html,application/json,image/avif,image/webp,image/*;q=0.9,*/*;q=0.8"}], responseEncoding: "base64"}, controller.signal);
  } finally { clearTimeout(timer); }
}

function bytes(result: ProxyResult): Uint8Array<ArrayBuffer> {
  if (!result.bodyEncoding?.startsWith("base64")) return new TextEncoder().encode(result.body);
  return Uint8Array.from(atob(result.body), char => char.charCodeAt(0));
}
function text(result: ProxyResult): string {
  const data = bytes(result);
  const sniff = new TextDecoder("ascii").decode(data.slice(0, 4096));
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(result.contentType || "")?.[1] || /charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] || "utf-8";
  try { return new TextDecoder(charset).decode(data); } catch { return new TextDecoder().decode(data); }
}

export async function fetchCard(original: string, timeout = 7000): Promise<CardData> {
  const deadline = Date.now() + timeout;
  const remaining = () => { const ms = deadline - Date.now(); if (ms < 100) throw new Error("超时"); return ms; };
  let url = original;
  try {
    for (let i = 0; i < 4 && /^(b23\.tv|v\.douyin\.com)$/.test(new URL(url).hostname); i++) {
      const response = await proxy(url, remaining(), url, false);
      const location = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === "location")?.[1];
      const target = Array.isArray(location) ? location[0] : location;
      if (response.status < 300 || response.status >= 400 || !target) break;
      const next = webURL(target, url); if (!next) break; url = next;
    }
    const address = new URL(url);
    if (/(^|\.)bilibili\.com$/.test(address.hostname)) {
      const id = /\/video\/(BV[\w]+|av\d+)/i.exec(address.pathname)?.[1];
      if (id) {
        try {
          const query = /^av/i.test(id) ? `aid=${id.slice(2)}` : `bvid=${id}`;
          const result = await proxy(`https://api.bilibili.com/x/web-interface/view?${query}`, remaining(), "https://www.bilibili.com/");
          const json = JSON.parse(text(result));
          const video = platformPreview(json, url);
          if (result.status === 200 && json.code === 0 && video.image) return normalizeCard({...fallbackCard(original), ...video, site: "哔哩哔哩", fetched: true});
        } catch { /* Fall back to public HTML. */ }
      }
    }
    let result = await proxy(url, remaining());
    let html = text(result).slice(0, 2_000_000);
    let card = result.status >= 200 && result.status < 300 && /html/i.test(result.contentType || "text/html") ? metadata(html, url) : fallbackCard(original);
    if (/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(address.hostname) && !card.image) {
      const id = /\/(?:video|note)\/(\d+)/.exec(address.pathname)?.[1] || address.searchParams.get("modal_id");
      if (id) {
        // Read public responses only; never run verification scripts or obtain cookies.
        try {
          result = await proxy(`https://www.iesdouyin.com/share/video/${id}/`, remaining(), "https://www.douyin.com/");
          if (result.status === 200) {
            html = text(result).slice(0, 2_000_000);
            const share = metadata(html, `https://www.douyin.com/video/${id}`);
            if (share.image) card = share;
          }
        } catch { /* Keep useful metadata. */ }
        if (!card.image) try {
          result = await proxy(`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`, remaining(), "https://www.douyin.com/");
          const video = platformPreview(JSON.parse(text(result)), `https://www.douyin.com/video/${id}`);
          if (result.status === 200 && video.image) card = normalizeCard({...card, ...video, site: "抖音", fetched: true});
        } catch { /* Missing cover remains an explicit result. */ }
      }
    }
    card.url = original;
    return card;
  } catch { return fallbackCard(original); }
}

function imageType(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((v,i) => data[i] === v)) return "image/png";
  const head = new TextDecoder("ascii").decode(data.slice(0, 32));
  if (/^GIF8[79]a/.test(head)) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8,12) === "WEBP") return "image/webp";
  if (head.slice(4,8) === "ftyp" && /avif|avis/.test(head)) return "image/avif";
  return "";
}

export async function coverBlob(url: string, source: string, timeout = 7000): Promise<Blob> {
  const result = await proxy(url, timeout, source);
  if (result.status < 200 || result.status >= 300 || result.body.length > 11_200_000) throw new Error("封面下载失败或超过 8 MiB");
  const data = bytes(result), type = imageType(data);
  if (!type || !data.length || data.length > 8 * 1024 * 1024) throw new Error("响应不是支持的图片");
  return new Blob([data], {type});
}

export async function cacheCover(card: CardData, timeout = 7000): Promise<CardData> {
  if (!card.image) return {...card, imageStatus: "missing"};
  if (!webURL(card.image)) return card;
  try {
    const blob = await coverBlob(card.image, card.url, timeout);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    const hash = Array.from(digest).map(v => v.toString(16).padStart(2, "0")).join("").slice(0, 24);
    const extension = ({"image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/gif":"gif", "image/avif":"avif"} as Record<string,string>)[blob.type];
    const filename = `cardlink-${hash}.${extension}`;
    const form = new FormData(); form.append("assetsDirPath", "/assets/"); form.append("file[]", blob, filename);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch("/api/asset/upload", {method: "POST", body: form, signal: controller.signal});
      const result = await response.json();
      const path = result.data?.succMap?.[filename];
      if (!response.ok || result.code !== 0 || typeof path !== "string" || !/^assets\//.test(path)) throw new Error("封面附件保存失败");
      return normalizeCard({...card, image: path, imageSource: card.image, imageStatus: "cached"});
    } finally { clearTimeout(timer); }
  } catch { return {...card, imageStatus: "remote"}; }
}
