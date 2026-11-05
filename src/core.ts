export interface CardData {
  version: 1;
  url: string;
  title: string;
  description: string;
  site: string;
  image: string;
  favicon: string;
  fetched: boolean;
  compact?: boolean;
  remoteImages?: boolean;
}

export const PLUGIN = "siyuan-auto-card-link";
export function webURL(value: string, base?: string): string {
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}

export function singleURL(text: string): string {
  const value = text.trim();
  if (/\s/.test(value)) return "";
  const url = webURL(value);
  if (!url || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#]|$)/i.test(url)) return "";
  return url;
}

export function fallbackCard(url: string): CardData {
  const safe = webURL(url);
  if (!safe) throw new Error("请输入完整的 http:// 或 https:// 网址");
  const host = new URL(safe).hostname;
  return {version: 1, url: safe, title: host, description: "", site: host, image: "", favicon: "", fetched: false};
}

const clean = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function metadata(html: string, url: string): CardData {
  const card = fallbackCard(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const metas = new Map<string, string>();
  for (const el of doc.querySelectorAll("meta")) {
    const key = (el.getAttribute("property") || el.getAttribute("name") || "").toLowerCase();
    if (!metas.get(key)) metas.set(key, el.getAttribute("content") || "");
  }
  const pick = (...keys: string[]) => keys.map(key => metas.get(key)).find(Boolean) || "";
  card.title = clean(pick("og:title", "twitter:title") || doc.title || card.title, 300);
  card.description = clean(pick("og:description", "twitter:description", "description"), 1000);
  card.site = clean(pick("og:site_name") || card.site, 100);
  const base = webURL(doc.querySelector("base[href]")?.getAttribute("href") || "", url) || url;
  const image = pick("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src");
  card.image = image ? webURL(image, base) : "";
  const icon = Array.from(doc.querySelectorAll("link[rel][href]")).find(el => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.getAttribute("rel") || ""));
  card.favicon = webURL(icon?.getAttribute("href") || "/favicon.ico", base);
  card.fetched = Boolean(doc.title || pick("og:title", "twitter:title", "description", "og:description"));
  // An anti-bot/login response is not a useful preview.
  if (/^(just a moment|access denied|attention required|verify you are human|安全验证|验证中心)/i.test(card.title)) return fallbackCard(url);
  return card;
}

export function normalizeCard(value: unknown): CardData {
  if (!value || typeof value !== "object") throw new Error("卡片数据无效");
  const data = value as Record<string, unknown>;
  const card = fallbackCard(String(data.url || ""));
  for (const key of ["title", "description", "site"] as const) {
    if (typeof data[key] === "string") card[key] = clean(data[key], key === "description" ? 1000 : 300);
  }
  card.title ||= new URL(card.url).hostname;
  card.image = typeof data.image === "string" ? webURL(data.image) : "";
  card.favicon = typeof data.favicon === "string" ? webURL(data.favicon) : "";
  card.fetched = data.fetched === true;
  card.compact = data.compact === true;
  card.remoteImages = data.remoteImages !== false;
  return card;
}

export function cardHTML(data: CardData): string {
  const encoded = encodeURIComponent(JSON.stringify(normalizeCard(data)));
  const height = data.compact ? 112 : 156;
  return `<iframe src="/plugins/${PLUGIN}/card.html#${encoded}" data-src="/plugins/${PLUGIN}/card.html#${encoded}" data-subtype="widget" border="0" frameborder="no" framespacing="0" allowfullscreen="false" style="width: 100%; height: ${height}px;"></iframe>`;
}

export function readCard(src: string): CardData | null {
  try {
    const url = new URL(src, "https://siyuan.local");
    if (url.pathname !== `/plugins/${PLUGIN}/card.html`) return null;
    if (url.hash.length > 30000) return null;
    return normalizeCard(JSON.parse(decodeURIComponent(url.hash.slice(1))));
  } catch { return null; }
}
