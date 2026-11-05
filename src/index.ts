import {Plugin, Dialog, Setting, showMessage} from "siyuan";
import {cardHTML, cardMarkdown, fallbackCard, imagePath, normalizeCard, readCard, singleURL, webURL, type CardData} from "./core";
import {api, cacheCover, fetchCard} from "./network";

type Options = {autoPaste: boolean; compact: boolean; remoteImages: boolean; cacheImages: boolean; timeout: number};
const defaults: Options = {autoPaste: true, compact: false, remoteImages: true, cacheImages: true, timeout: 7000};
type PasteDetail = {textPlain: string; textHTML: string; siyuanHTML: string; files?: {length: number}; protyle: {disabled?: boolean; lute?: {Md2BlockDOM: (md: string) => string}}; resolve: (data: {textPlain?: string; textHTML?: string; siyuanHTML?: string; files?: unknown}) => void};
type BlockMenuDetail = {menu: {addItem: (item: {label: string; icon?: string; click: () => void}) => void}; blockElements: HTMLElement[]};

export default class AutoCardLink extends Plugin {
  private options = {...defaults};
  private stopped = false;
  private dialogs = new Set<Dialog>();
  async onload() {
    const stored = await this.loadData("settings.json").catch(() => null);
    this.options = {...defaults, ...stored};
    this.options.timeout = Math.max(2000, Math.min(15000, Number(this.options.timeout) || 7000));
    this.initSettings();
    this.eventBus.on("paste", this.onPaste);
    this.eventBus.on("click-blockicon", this.onBlockMenu);
    this.addCommand({langKey: "insertCard", hotkey: "⇧⌘K", editorCallback: protyle => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      const node = range?.startContainer;
      const element = node instanceof Element ? node : node?.parentElement;
      const block = element?.closest<HTMLElement>("[data-node-id]");
      const id = block && protyle.wysiwyg?.element.contains(block) ? block.dataset.nodeId : undefined;
      if (!id || protyle.disabled) { showMessage("请先把光标放在可编辑的笔记块中"); return; }
      const selection = window.getSelection()?.toString().trim() || "";
      this.editDialog(singleURL(selection), undefined, async card => {
        await api("/api/block/insertBlock", {dataType: "markdown", data: cardMarkdown(card), previousID: id});
      });
    }});
    this.protyleSlash = [{filter: ["cardlink", "链接卡片", "ljkp"], html: '<span class="b3-list-item__text">插入链接卡片</span>', id: "insert-card-link", callback: protyle => {
      // Protyle.insert uses the host's retained slash-command range.
      const range = protyle.protyle.toolbar?.range?.cloneRange() || (window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).cloneRange() : null);
      this.editDialog("", undefined, async card => {
        if (!range?.startContainer.isConnected) throw new Error("插入位置已失效，请重新打开命令");
        const selection = window.getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
        if (!protyle.protyle.lute) throw new Error("编辑器尚未就绪，请重试");
        protyle.insert(protyle.protyle.lute.Md2BlockDOM(cardMarkdown(card)), true);
      });
    }}];
  }

  onunload() {
    this.stopped = true;
    this.dialogs.forEach(dialog => dialog.destroy());
    this.dialogs.clear();
    this.eventBus.off("paste", this.onPaste);
    this.eventBus.off("click-blockicon", this.onBlockMenu);
  }

  private onPaste = (event: CustomEvent<PasteDetail>) => {
    const d = event.detail;
    if (!this.options.autoPaste || this.stopped || d.protyle.disabled || d.files?.length || d.siyuanHTML) return;
    const url = singleURL(d.textPlain || "");
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    const node = range?.startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    // Leave selected text, inline text, code, tables and existing widgets to SiYuan.
    if (!url || !range?.collapsed || element?.closest('[data-type="NodeCodeBlock"], [data-type="NodeTable"], [data-type="NodeWidget"], [data-type~="code"]')) return;
    const editable = element?.closest('[contenteditable="true"]');
    if (!editable || editable.textContent?.replace(/[\u200b\u200c\u200d\ufeff]/g, "").trim()) return;
    event.preventDefault();
    void this.makeCard(url).then(card => {
      if (!card.fetched) showMessage("未取得网页信息，已保留链接卡片，可在块菜单补充标题和封面", 5000);
      d.resolve(this.stopped ? {textPlain: d.textPlain, textHTML: d.textHTML, siyuanHTML: d.siyuanHTML, files: d.files} :
        d.protyle.lute ? {siyuanHTML: d.protyle.lute.Md2BlockDOM(cardMarkdown(card)), textPlain: "", textHTML: ""} : {textPlain: "", textHTML: cardHTML(card)});
    }).catch(() => d.resolve({textPlain: d.textPlain, textHTML: d.textHTML, siyuanHTML: d.siyuanHTML, files: d.files}));
  };

  private onBlockMenu = (event: CustomEvent<BlockMenuDetail>) => {
    const {blockElements, menu} = event.detail;
    if (blockElements.length !== 1) return;
    const block = blockElements[0];
    const iframe = block.querySelector("iframe");
    const data = readCard(iframe?.getAttribute("src") || iframe?.getAttribute("data-src") || "");
    if (!data || !block.dataset.nodeId) return;
    const id = block.dataset.nodeId;
    menu.addItem({label: "编辑链接卡片", icon: "iconEdit", click: () => this.editDialog(data.url, data, card => api("/api/block/updateBlock", {id, dataType: "markdown", data: cardMarkdown(card)}).then(() => undefined))});
    menu.addItem({label: "重新获取封面", icon: "iconRefresh", click: () => {
      void this.makeCard(data.url).then(async fresh => {
        if (!fresh.image) { showMessage("未获取到封面，原卡片已保留；网站可能要求登录或验证", 6000); return; }
        await api("/api/block/updateBlock", {id, dataType: "markdown", data: cardMarkdown({...data, image: fresh.image, imageSource: fresh.imageSource, imageStatus: fresh.imageStatus})});
        showMessage(fresh.imageStatus === "cached" ? "封面已更新并保存为本地附件" : "封面已更新；本地下载失败，暂用远程地址");
      }).catch(error => showMessage(String(error)));
    }});
    menu.addItem({label: "复制原网址", icon: "iconCopy", click: () => { void navigator.clipboard.writeText(data.url).catch(() => showMessage("复制失败，请从编辑窗口复制网址")); }});
    menu.addItem({label: "还原为普通链接", icon: "iconLink", click: () => { void api("/api/block/updateBlock", {id, dataType: "markdown", data: `<${data.url.replace(/>/g, "%3E")}>`}).catch(error => showMessage(String(error))); }});
  };

  private async makeCard(url: string) {
    let card = await fetchCard(url, this.options.timeout);
    if (this.options.cacheImages && this.options.remoteImages) card = await cacheCover(card, this.options.timeout);
    return {...card, compact: this.options.compact, remoteImages: this.options.remoteImages};
  }

  private editDialog(url: string, existing: CardData | undefined, save: (card: CardData) => Promise<void>) {
    const dialog = new Dialog({title: existing ? "编辑链接卡片" : "插入链接卡片", width: "600px", destroyCallback: () => { this.dialogs.delete(dialog); }, content: `<div class="b3-dialog__content" style="display:grid;gap:12px">
      <label>网址<input class="b3-text-field fn__block" data-field="url" placeholder="https://…"></label>
      <div><button class="b3-button b3-button--outline" data-action="fetch">获取网页信息</button><span data-status style="margin-left:12px;font-size:12px" role="status"></span></div>
      <label>标题<input class="b3-text-field fn__block" data-field="title" placeholder="留空时使用域名"></label>
      <label>摘要<textarea class="b3-text-field fn__block" data-field="description" rows="3"></textarea></label>
      <label>网站名称<input class="b3-text-field fn__block" data-field="site"></label>
      <label>封面网址或附件路径<input class="b3-text-field fn__block" data-field="image" placeholder="https://… 或 assets/…（可选）"></label>
      <label><input type="checkbox" data-field="compact"> 紧凑卡片（隐藏封面和摘要）</label>
      <label><input type="checkbox" data-field="remoteImages"> 加载远程封面和网站图标</label>
      </div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-action="cancel">取消</button><div class="fn__space"></div><button class="b3-button b3-button--text" data-action="save">保存卡片</button></div>`});
    this.dialogs.add(dialog);
    const field = (key: string) => dialog.element.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${key}"]`)!;
    const status = dialog.element.querySelector<HTMLElement>("[data-status]")!;
    let snapshot = existing || {...fallbackCard(url || "https://example.com"), title: "", site: "", compact: this.options.compact, remoteImages: this.options.remoteImages};
    const fill = (card: CardData) => {
      for (const key of ["url", "title", "description", "site", "image"] as const) field(key).value = card[key];
      (field("compact") as HTMLInputElement).checked = !!card.compact;
      (field("remoteImages") as HTMLInputElement).checked = card.remoteImages !== false;
    };
    fill(snapshot); field("url").value = url;
    const fetchButton = dialog.element.querySelector<HTMLButtonElement>('[data-action="fetch"]')!;
    const saveButton = dialog.element.querySelector<HTMLButtonElement>('[data-action="save"]')!;
    let revision = 0;
    dialog.element.querySelector('[data-action="cancel"]')!.addEventListener("click", () => dialog.destroy());
    dialog.element.addEventListener("input", () => { revision++; });
    fetchButton.addEventListener("click", async () => {
      const address = webURL(field("url").value.trim());
      if (!address) { status.textContent = "请输入完整的 http(s) 网址"; return; }
      const currentRevision = revision;
      fetchButton.disabled = true; saveButton.disabled = true; status.textContent = "正在获取…";
      const card = await this.makeCard(address);
      if (currentRevision === revision && dialog.element.isConnected) {
        card.compact = (field("compact") as HTMLInputElement).checked;
        card.remoteImages = (field("remoteImages") as HTMLInputElement).checked;
        if (card.fetched) { snapshot = card; fill(card); }
        status.textContent = card.fetched ? card.imageStatus === "cached" ? "已获取；封面已保存到本地附件" : card.image ? "已获取；封面使用远程地址" : "已获取文字，未发现封面，可手动填写" : "无法获取，网站可能要求验证；可手动填写";
      } else { status.textContent = "内容已修改，请重新获取或手动保存"; }
      fetchButton.disabled = false; saveButton.disabled = false;
    });
    saveButton.addEventListener("click", async () => {
      try {
        saveButton.disabled = true;
        const data = {...snapshot, url: field("url").value.trim(), title: field("title").value, description: field("description").value, site: field("site").value, image: field("image").value.trim(), compact: (field("compact") as HTMLInputElement).checked, remoteImages: (field("remoteImages") as HTMLInputElement).checked};
        if (data.image && !imagePath(data.image)) throw new Error("封面需要完整的 http(s) 图片网址或 assets/ 附件路径");
        let card = normalizeCard(data);
        if (this.options.cacheImages && card.remoteImages !== false && webURL(card.image)) card = await cacheCover(card, this.options.timeout);
        await save(card);
        dialog.destroy();
      } catch (error) { status.textContent = String(error instanceof Error ? error.message : error); saveButton.disabled = false; }
    });
    field("url").focus();
  }

  private initSettings() {
    this.setting = new Setting({confirmCallback: () => { void this.saveData("settings.json", this.options).catch(() => showMessage("设置保存失败，请重试")); }});
    for (const [key, title, description] of [
      ["autoPaste", "粘贴网址自动生成卡片", "仅接管空白段落中的单个网址；正文、代码、表格、图片和文件保持原粘贴方式。"],
      ["compact", "默认使用紧凑卡片", "隐藏封面和摘要；每张卡片可单独调整。"],
      ["remoteImages", "默认加载远程图片", "允许下载封面和加载远程图标；关闭后仍显示已保存的本地封面。已有卡片请在块菜单中修改。"],
      ["cacheImages", "封面保存为本地附件", "默认开启。通过思源内核下载封面，减少防盗链、离线和临时链接过期的影响。"]
    ] as const) {
      const input = document.createElement("input"); input.type = "checkbox"; input.className = "b3-switch"; input.checked = this.options[key];
      input.addEventListener("change", () => { this.options[key] = input.checked; });
      this.setting.addItem({title, description, actionElement: input});
    }
  }
}
