// Minimal host adapter for UI behavior tests; this is not an Electron host test.
export class Dialog {
  static instances: Dialog[] = [];
  element = document.createElement("section");
  constructor(private options: { content: string; destroyCallback?: () => void }) {
    this.element.innerHTML = options.content; document.body.append(this.element); Dialog.instances.push(this);
  }
  destroy() { this.element.remove(); this.options.destroyCallback?.(); }
}
export class Protyle {
  static instances: Protyle[] = [];
  disabled = false; destroyed = false;
  constructor(_app: unknown, _element: HTMLElement, public options: unknown) { Protyle.instances.push(this); }
  disable() { this.disabled = true; }
  destroy() { this.destroyed = true; }
}
