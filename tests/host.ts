export class Plugin {
  commands: any[] = [];
  eventBus = {on: (..._args: any[]) => {}, off: (..._args: any[]) => {}};
  protyleSlash: any[] = [];
  setting: any;
  async loadData(_name: string) { return {}; }
  async saveData(_name: string, _value: any) {}
  addCommand(command: any) { this.commands.push(command); }
}
export class Setting { constructor(_options: any) {} addItem(_item: any) {} }
export class Dialog {
  element = document.createElement("div");
  constructor(options: any) { this.element.innerHTML = options.content; document.body.append(this.element); }
  destroy() { this.element.remove(); }
}
export function showMessage(..._args: any[]) {}
