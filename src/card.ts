import {readCard} from "./core";

const card = readCard(location.href);
const root = document.getElementById("card")!;
function theme() {
  try {
    const style = parent.getComputedStyle(window.frameElement || parent.document.documentElement);
    for (const name of ["--b3-theme-background", "--b3-theme-on-background", "--b3-theme-surface", "--b3-theme-on-surface", "--b3-border-color", "--b3-theme-primary"]) {
      const value = style.getPropertyValue(name);
      if (value) document.documentElement.style.setProperty(name, value);
    }
  } catch { /* Standalone previews use the system theme. */ }
}
theme();
try {
  new MutationObserver(theme).observe(parent.document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode", "data-theme", "style"]});
} catch { /* A parent is optional. */ }

if (!card) {
  root.textContent = "卡片数据无效，请通过块菜单重新编辑。";
} else {
  root.classList.toggle("compact", !!card.compact);
  const link = document.createElement("a");
  link.href = card.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "card-link";
  link.title = card.url;
  const copy = document.createElement("div");
  copy.className = "copy";
  const site = document.createElement("div");
  site.className = "site";
  if (card.favicon && card.remoteImages !== false) {
    const favicon = document.createElement("img");
    favicon.src = card.favicon;
    favicon.referrerPolicy = "no-referrer";
    favicon.alt = "";
    favicon.addEventListener("error", () => favicon.remove(), {once: true});
    site.append(favicon);
  }
  const name = document.createElement("span");
  name.textContent = card.site || new URL(card.url).hostname;
  site.append(name);
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = card.title;
  copy.append(site, title);
  if (card.description && !card.compact) {
    const description = document.createElement("div");
    description.className = "description";
    description.textContent = card.description;
    copy.append(description);
  }
  const address = document.createElement("div");
  address.className = "address";
  address.textContent = new URL(card.url).hostname + new URL(card.url).pathname.replace(/\/$/, "");
  copy.append(address);
  link.append(copy);
  if (card.image && card.remoteImages !== false && !card.compact) {
    const cover = document.createElement("img");
    cover.className = "cover";
    cover.alt = "";
    cover.src = card.image;
    cover.referrerPolicy = "no-referrer";
    cover.addEventListener("error", () => cover.remove(), {once: true});
    link.append(cover);
  }
  const arrow = document.createElement("span");
  arrow.className = "arrow";
  arrow.textContent = "↗";
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  root.append(link);
}
