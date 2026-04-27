// IAndes — Floating popup panel injected on supported sites.
// Shows popup.html as a draggable, repositionable window so the user
// doesn't need to open the extension action popup.

(() => {
  const PANEL_HOST_ID = "iandes-floating-panel-host";
  const STORAGE_PREFIX = "iandes_floating_panel:";

  if (document.getElementById(PANEL_HOST_ID)) return;
  if (!document.documentElement) return;

  const hostKey = `${STORAGE_PREFIX}${location.hostname}`;
  const extensionOrigin = new URL(chrome.runtime.getURL("popup.html")).origin;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getDefaultRect() {
    const width = 332;
    const height = 340;
    const margin = 18;
    const left = Math.max(margin, window.innerWidth - width - margin);
    const top = 96;
    return { left, top, width, height };
  }

  async function loadState() {
    const defaults = { rect: getDefaultRect(), minimized: false, hidden: false };
    try {
      const data = await chrome.storage.local.get(hostKey);
      const state = data?.[hostKey];
      if (!state || typeof state !== "object") return defaults;
      return {
        rect: { ...defaults.rect, ...(state.rect || {}) },
        minimized: Boolean(state.minimized),
        hidden: Boolean(state.hidden),
      };
    } catch {
      return defaults;
    }
  }

  async function saveState(next) {
    try {
      await chrome.storage.local.set({ [hostKey]: next });
    } catch {
      // Ignore storage failures (private mode / quotas).
    }
  }

  function createEl(tag, attrs = {}) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "text") el.textContent = value;
      else if (key === "class") el.className = value;
      else el.setAttribute(key, value);
    }
    return el;
  }

  function buildUI(state) {
    const host = createEl("div", { id: PANEL_HOST_ID });
    // Highest reasonable z-index without going "infinite".
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "open" });
    const style = createEl("style");
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed;
        left: ${state.rect.left}px;
        top: ${state.rect.top}px;
        width: ${state.rect.width}px;
        height: ${state.rect.height}px;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(0, 230, 150, 0.22);
        background: #0b0f1a;
        box-shadow: 0 16px 48px rgba(0,0,0,0.45);
        display: ${state.hidden ? "none" : "flex"};
        flex-direction: column;
      }
      .bar {
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px 0 10px;
        background: rgba(19, 25, 41, 0.95);
        border-bottom: 1px solid rgba(0, 230, 150, 0.18);
        cursor: grab;
        user-select: none;
      }
      .bar:active { cursor: grabbing; }
      .title {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        letter-spacing: 0.02em;
        color: #dff5e8;
        opacity: 0.95;
      }
      .btns { display: flex; gap: 6px; }
      button {
        all: unset;
        width: 26px;
        height: 22px;
        border-radius: 7px;
        display: grid;
        place-items: center;
        font-size: 12px;
        color: #dff5e8;
        opacity: 0.85;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.04);
        cursor: pointer;
      }
      button:hover { opacity: 1; background: rgba(255,255,255,0.07); }
      .frameWrap { flex: 1; display: ${state.minimized ? "none" : "block"}; }
      iframe {
        border: 0;
        width: 100%;
        height: 100%;
        display: block;
        background: #0b0f1a;
      }
      .tab {
        position: fixed;
        left: 14px;
        top: 120px;
        display: ${state.hidden ? "grid" : "none"};
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        border: 1px solid rgba(0, 230, 150, 0.22);
        background: rgba(11, 15, 26, 0.92);
        color: #00e696;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        cursor: pointer;
        user-select: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 16px;
      }
      .tab:hover { background: rgba(19, 25, 41, 0.92); }
    `;

    const panel = createEl("div", { class: "panel" });
    const bar = createEl("div", { class: "bar" });
    const title = createEl("div", { class: "title", text: "IAndes" });
    const btns = createEl("div", { class: "btns" });
    const btnMin = createEl("button", { title: "Minimizar", "aria-label": "Minimizar", text: "–" });
    const btnHide = createEl("button", { title: "Ocultar", "aria-label": "Ocultar", text: "×" });
    btns.append(btnMin, btnHide);
    bar.append(title, btns);

    const frameWrap = createEl("div", { class: "frameWrap" });
    const iframe = createEl("iframe", {
      src: chrome.runtime.getURL("popup.html"),
      title: "IAndes panel",
      referrerpolicy: "no-referrer",
    });
    frameWrap.appendChild(iframe);
    panel.append(bar, frameWrap);

    const tab = createEl("div", { class: "tab", title: "Mostrar IAndes", text: "IA" });

    shadow.append(style, panel, tab);
    document.documentElement.appendChild(host);

    return { host, shadow, panel, bar, frameWrap, iframe, tab };
  }

  function wireMessaging(iframe) {
    function postContext(target) {
      const payload = {
        type: "IANDES_PANEL_CONTEXT",
        provider: window.__iandes?.provider || null,
        metrics: window.__iandes || null,
      };
      try {
        target.postMessage(payload, extensionOrigin);
      } catch {
        // ignore
      }
    }

    window.addEventListener("message", (event) => {
      if (event.origin !== extensionOrigin) return;
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "IANDES_PANEL_REQUEST") {
        postContext(event.source);
      }
    });

    iframe.addEventListener("load", () => {
      if (iframe.contentWindow) postContext(iframe.contentWindow);
    });
  }

  function wireDragAndControls(ui, state) {
    let dragging = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let startLeft = 0;
    let startTop = 0;

    const getRect = () => ui.panel.getBoundingClientRect();

    function applyPosition(left, top, persist = false) {
      const rect = getRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const clampedLeft = clamp(left, 8, maxLeft);
      const clampedTop = clamp(top, 8, maxTop);
      ui.panel.style.left = `${clampedLeft}px`;
      ui.panel.style.top = `${clampedTop}px`;
      state.rect.left = clampedLeft;
      state.rect.top = clampedTop;
      if (persist) void saveState(state);
    }

    ui.bar.addEventListener("pointerdown", (e) => {
      // Ignore clicks on buttons.
      const target = e.target;
      if (target && target.tagName === "BUTTON") return;
      if (state.hidden) return;
      dragging = true;
      ui.bar.setPointerCapture?.(e.pointerId);
      const rect = getRect();
      startPointerX = e.clientX;
      startPointerY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    ui.bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;
      applyPosition(startLeft + dx, startTop + dy, false);
    });

    ui.bar.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      ui.bar.releasePointerCapture?.(e.pointerId);
      void saveState(state);
    });

    ui.shadow.querySelector("button[aria-label='Minimizar']")?.addEventListener("click", async () => {
      state.minimized = !state.minimized;
      ui.frameWrap.style.display = state.minimized ? "none" : "block";
      await saveState(state);
    });

    ui.shadow.querySelector("button[aria-label='Ocultar']")?.addEventListener("click", async () => {
      state.hidden = true;
      ui.panel.style.display = "none";
      ui.tab.style.display = "grid";
      await saveState(state);
    });

    ui.tab.addEventListener("click", async () => {
      state.hidden = false;
      ui.panel.style.display = "flex";
      ui.tab.style.display = "none";
      await saveState(state);
    });

    window.addEventListener("resize", () => {
      applyPosition(state.rect.left, state.rect.top, true);
    });
  }

  (async () => {
    const state = await loadState();
    const ui = buildUI(state);
    wireMessaging(ui.iframe);
    wireDragAndControls(ui, state);
  })();
})();

