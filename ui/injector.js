/**
 * Subagents Dashboard — Tab Injector for OpenClaw Control UI
 *
 * Injects a "Subagents" tab into the Control UI sidebar (Shadow DOM).
 * Uses MutationObserver on childList only (NO attributes) to avoid
 * infinite mutation loops that freeze the page.
 */
(function () {
  "use strict";

  const PLUGIN_URL = "/plugins/openclaw-subagents/";
  const TAB_HASH = "#/subagents";
  const INJECT_ATTR = "data-subagents-dash";

  const ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><line x1="6.3" y1="5.7" x2="9.9" y2="9.3"/><line x1="14.1" y1="9.3" x2="17.7" y2="5.7"/><line x1="9.9" y1="14.7" x2="6.3" y2="18.3"/><line x1="14.1" y1="14.7" x2="17.7" y2="18.3"/></svg>`;

  let active = false;
  let iframeBox = null;
  let mutationPending = false;
  let _root = null;

  function getRoot(app) {
    return app.shadowRoot || app;
  }

  function waitForApp(cb) {
    let n = 0;
    const poll = () => {
      n++;
      const app = document.querySelector("openclaw-app");
      if (!app) { if (n < 200) setTimeout(poll, 50); return; }
      const root = getRoot(app);
      const nav = root.querySelector("aside.nav, aside, .nav");
      if (nav) cb(app, root, nav);
      else if (n < 200) setTimeout(poll, 50);
    };
    poll();
  }

  function injectTab(nav) {
    if (nav.querySelector(`[${INJECT_ATTR}]`)) return;

    const group = document.createElement("div");
    group.className = "nav-group";
    group.setAttribute(INJECT_ATTR, "");
    group.innerHTML = `
      <button class="nav-label" aria-expanded="true">
        <span class="nav-label__text">Monitoring</span>
        <span class="nav-label__chevron">\u2212</span>
      </button>
      <div class="nav-group__items">
        <a href="${TAB_HASH}" class="nav-item" title="Subagents Dashboard"
           data-subagents-tab ${INJECT_ATTR}>
          <span class="nav-item__icon" aria-hidden="true">${ICON_SVG}</span>
          <span class="nav-item__text">Subagents</span>
        </a>
      </div>`;

    const links = nav.querySelector(".nav-group--links");
    if (links) nav.insertBefore(group, links);
    else nav.appendChild(group);

    // Collapse toggle
    const label = group.querySelector(".nav-label");
    const chevron = group.querySelector(".nav-label__chevron");
    const items = group.querySelector(".nav-group__items");
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = items.style.display === "none";
      items.style.display = collapsed ? "" : "none";
      chevron.textContent = collapsed ? "\u2212" : "+";
    });

    // Tab click
    group.querySelector("[data-subagents-tab]").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activate();
    });
  }

  function ensureIframe() {
    if (iframeBox || !_root) return;
    const main = _root.querySelector("main.content, main, .content");
    if (!main) return;

    iframeBox = document.createElement("div");
    iframeBox.setAttribute(INJECT_ATTR, "iframe");
    iframeBox.style.cssText =
      "display:none;position:absolute;inset:0;z-index:50;background:var(--bg,#12141a);";

    const iframe = document.createElement("iframe");
    iframe.src = PLUGIN_URL;
    iframe.style.cssText = "width:100%;height:100%;border:none;background:var(--bg,#12141a);";
    iframe.setAttribute("allow", "clipboard-write");
    iframe.setAttribute("title", "Subagents Dashboard");
    iframeBox.appendChild(iframe);

    if (window.getComputedStyle(main).position === "static") {
      main.style.position = "relative";
    }
    main.appendChild(iframeBox);
  }

  function activate() {
    if (active || !_root) return;
    active = true;
    ensureIframe();

    const main = _root.querySelector("main.content, main, .content");
    if (main) {
      for (const ch of main.children) {
        if (ch.getAttribute(INJECT_ATTR) === "iframe") ch.style.display = "block";
        else { ch.dataset._subPrev = ch.style.display; ch.style.display = "none"; }
      }
    }

    const nav = _root.querySelector("aside.nav, aside, .nav");
    if (nav) {
      nav.querySelectorAll(".nav-item").forEach((el) => {
        if (el.hasAttribute(INJECT_ATTR)) el.classList.add("active");
        else el.classList.remove("active");
      });
    }
    history.pushState(null, "", TAB_HASH);
  }

  function deactivate() {
    if (!active || !_root) return;
    active = false;
    if (iframeBox) iframeBox.style.display = "none";

    const main = _root.querySelector("main.content, main, .content");
    if (main) {
      for (const ch of main.children) {
        if (ch.getAttribute(INJECT_ATTR) !== "iframe" && ch.dataset._subPrev !== undefined) {
          ch.style.display = ch.dataset._subPrev;
          delete ch.dataset._subPrev;
        }
      }
    }
    const tab = _root.querySelector("[data-subagents-tab]");
    if (tab) tab.classList.remove("active");
  }

  waitForApp(function (app, root, nav) {
    _root = root;
    injectTab(nav);

    // Observe nav only, childList only — no attributes to avoid infinite loops
    const observer = new MutationObserver(() => {
      if (mutationPending) return;
      mutationPending = true;
      requestAnimationFrame(() => {
        mutationPending = false;
        const cur = root.querySelector("aside.nav, aside, .nav");
        if (!cur) return;
        if (!cur.querySelector(`[${INJECT_ATTR}]`)) injectTab(cur);
        if (active) {
          const other = cur.querySelector(".nav-item.active:not([data-subagents-tab])");
          if (other) deactivate();
        }
      });
    });
    observer.observe(nav, { childList: true, subtree: true });

    // Watch for nav replacement by Lit
    const navParent = nav.parentElement;
    if (navParent) {
      new MutationObserver(() => {
        const newNav = root.querySelector("aside.nav, aside, .nav");
        if (newNav && !newNav.querySelector(`[${INJECT_ATTR}]`)) {
          injectTab(newNav);
          observer.disconnect();
          observer.observe(newNav, { childList: true, subtree: true });
        }
      }).observe(navParent, { childList: true });
    }

    if (typeof app.setTab === "function") {
      const orig = app.setTab.bind(app);
      app.setTab = function (t) { deactivate(); return orig(t); };
    }

    window.addEventListener("popstate", () => {
      if (location.hash === TAB_HASH) activate();
      else if (active) deactivate();
    });

    if (location.hash === TAB_HASH) setTimeout(activate, 150);
  });
})();
