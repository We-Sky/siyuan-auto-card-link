import {fallbackCard, metadata, type CardData} from "./core";

export async function api<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body), signal});
  if (!response.ok) throw new Error(`思源接口请求失败 (${response.status})`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "思源接口请求失败");
  return result.data as T;
}

export async function fetchCard(url: string, timeout = 7000): Promise<CardData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout + 500);
  try {
    const result = await api<{status: number; body: string; bodyEncoding?: string; contentType?: string}>("/api/network/forwardProxy", {
      url, method: "GET", timeout, headers: [{"User-Agent": "Mozilla/5.0 (compatible; SiYuanAutoCardLink/0.1)", Accept: "text/html,application/xhtml+xml"}], responseEncoding: "base64"
    }, controller.signal);
    if (result.status < 200 || result.status >= 300 || !/html/i.test(result.contentType || "text/html")) return fallbackCard(url);
    let html = result.body;
    if (result.bodyEncoding?.startsWith("base64")) {
      const bytes = Uint8Array.from(atob(result.body), char => char.charCodeAt(0));
      const sniff = new TextDecoder("ascii").decode(bytes.slice(0, 4096));
      const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(result.contentType || "")?.[1] || /charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] || "utf-8";
      try { html = new TextDecoder(charset).decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
    }
    return metadata(html.slice(0, 2_000_000), url);
  } catch { return fallbackCard(url); }
  finally { clearTimeout(timer); }
}
