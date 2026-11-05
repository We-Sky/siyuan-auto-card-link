import {webURL} from "./core";

type Preview = {title?: string; description?: string; image?: string};
type RecordValue = Record<string, any>;

/** Read JSON only. Never execute JavaScript supplied by a remote page. */
function assignmentJSON(text: string, marker: string): unknown {
  const index = text.indexOf(marker);
  if (index < 0) return null;
  const start = text.indexOf("{", index + marker.length);
  if (start < 0 || start - index > 100) return null;
  let level = 0, quoted = false, escaped = false;
  for (let i = start; i < Math.min(text.length, start + 2_000_000); i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") level++;
    else if (char === "}" && --level === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function objects(value: unknown): RecordValue[] {
  const result: RecordValue[] = [], queue: unknown[] = [value];
  for (let i = 0; i < queue.length && i < 10000; i++) {
    const item = queue[i];
    if (!item || typeof item !== "object") continue;
    if (!Array.isArray(item)) result.push(item as RecordValue);
    for (const child of Object.values(item)) { if (queue.length >= 10000) break; queue.push(child); }
  }
  return result;
}

function imageValue(value: unknown, base: string): string {
  if (typeof value === "string") return webURL(value, base);
  if (Array.isArray(value)) return value.map(v => imageValue(v, base)).find(Boolean) || "";
  if (value && typeof value === "object") {
    const obj = value as RecordValue;
    return imageValue(obj.url || obj.contentUrl || obj.url_list || obj.urlList || obj.thumbnailUrl, base);
  }
  return "";
}

export function platformPreview(value: unknown, url: string): Preview {
  const host = new URL(url).hostname;
  const all = objects(value);
  if (/(^|\.)bilibili\.com$/.test(host)) {
    const id = /\/video\/(BV[\w]+|av\d+)/i.exec(new URL(url).pathname)?.[1];
    const video = all.find(obj => typeof obj.pic === "string" && typeof obj.title === "string" &&
      (!id || !obj.bvid || obj.bvid.toLowerCase() === id.toLowerCase() || /^av/i.test(id) && String(obj.aid) === id.slice(2)));
    if (video) return {title: video.title, description: video.desc, image: imageValue(video.pic, url)};
  }
  if (/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(host)) {
    const expected = /\/(?:video|note)\/(\d+)/.exec(new URL(url).pathname)?.[1] || new URL(url).searchParams.get("modal_id");
    const item = all.find(obj => obj.video && (obj.desc || obj.title) &&
      (!expected || String(obj.aweme_id || obj.awemeId || obj.item_id || "") === expected));
    if (item) return {title: item.desc || item.title, description: item.desc,
      image: imageValue(item.video.origin_cover || item.video.originCover || item.video.cover, url)};
  }
  return {};
}

export function extraPreview(doc: Document, url: string): Preview {
  let platform: Preview = {};
  let structured: Preview = {};
  for (const script of Array.from(doc.querySelectorAll("script")).slice(0, 150)) {
    const text = script.textContent || "";
    if (text.length > 2_000_000) continue;
    let value: unknown = null;
    try {
      if (script.id === "RENDER_DATA") value = JSON.parse(decodeURIComponent(text));
      else if (script.type === "application/ld+json" || script.type === "application/json") value = JSON.parse(text);
      else for (const marker of ["window.__INITIAL_STATE__=", "window.__INITIAL_STATE__ =", "window._ROUTER_DATA =", "window._ROUTER_DATA="]) {
        value = assignmentJSON(text, marker); if (value) break;
      }
    } catch { continue; }
    if (!value) continue;
    const candidate = platformPreview(value, url);
    if (candidate.image) platform = candidate;
    if (script.type === "application/ld+json") {
      const entries = objects(value).filter(obj => /Article|BlogPosting|VideoObject|WebPage|ImageObject/i.test(String(obj["@type"] || "")));
      for (const obj of entries) {
        const image = imageValue(obj.thumbnailUrl || obj.image || (obj["@type"] === "ImageObject" ? obj.contentUrl || obj.url : ""), url);
        if (image && !structured.image) structured = {image, title: obj.headline || obj.name, description: obj.description};
      }
    }
  }
  if (platform.image) return platform;
  if (structured.image) return structured;
  const direct = doc.querySelector('meta[itemprop="image"], meta[name="thumbnail"], link[rel="image_src"]');
  const image = direct && imageValue(direct.getAttribute("content") || direct.getAttribute("href"), url);
  if (image) return {image};
  // Prefer article content; never select a random navigation logo as the cover.
  for (const img of Array.from(doc.querySelectorAll('article img, [itemprop="articleBody"] img, #js_content img, .rich_media_content img, .article-content img, .post-content img, .entry-content img')).slice(0, 100)) {
    if (/avatar|logo|emoji|icon|qrcode|qr_code/i.test([img.className, img.getAttribute("alt"), img.getAttribute("src")].join(" "))) continue;
    const width = Number(img.getAttribute("width")), height = Number(img.getAttribute("height"));
    if (width > 0 && width < 100 || height > 0 && height < 70) continue;
    for (const attr of ["data-src", "data-original", "data-lazy-src", "data-actualsrc", "src"]) {
      const source = img.getAttribute(attr);
      if (!source) continue;
      const image = imageValue(source, url);
      if (image) return {image};
    }
  }
  return {};
}
