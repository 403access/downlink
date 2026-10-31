/* Downlink marketing site — progressive enhancement only. */

(() => {
  "use strict";

  const header = document.querySelector("[data-header]");
  const nav = document.querySelector("[data-nav]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const showcase = document.querySelector("[data-showcase]");

  const setHeaderState = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  window.addEventListener("scroll", setHeaderState, { passive: true });
  setHeaderState();

  if (menuToggle && nav) {
    menuToggle.addEventListener("click", () => {
      const open = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });

    nav.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLAnchorElement)) return;
      menuToggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    });
  }

  if (showcase) {
    const tabs = Array.from(showcase.querySelectorAll("[data-shot]"));
    const shots = Array.from(showcase.querySelectorAll("[data-shot-img]"));
    const caption = showcase.querySelector("[data-shot-caption]");

    const selectShot = (id, focus = false) => {
      tabs.forEach((tab) => {
        const active = tab.dataset.shot === id;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focus) tab.focus();
      });

      shots.forEach((shot) => {
        const active = shot.dataset.shotImg === id;
        shot.classList.toggle("is-active", active);
        shot.hidden = !active;
      });

      const activeTab = tabs.find((tab) => tab.dataset.shot === id);
      if (caption && activeTab) caption.textContent = activeTab.dataset.caption || "";
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectShot(tab.dataset.shot));

      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        selectShot(next.dataset.shot, true);
      });
    });

    // Make the tab strip behave like a real tablist from the start.
    tabs.forEach((tab) => {
      const active = tab.classList.contains("is-active");
      tab.tabIndex = active ? 0 : -1;
    });
  }

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  };

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const terminal = button.closest(".terminal");
      const code = terminal?.querySelector("pre code");
      if (!code) return;

      const label = button.querySelector("span");
      const original = label ? label.textContent : "";
      try {
        await copyText(code.textContent.trim());
        button.classList.add("is-copied");
        if (label) label.textContent = "Copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        button.classList.add("is-copied");
        if (label) label.textContent = "Press ⌘C";
      }

      window.setTimeout(() => {
        button.classList.remove("is-copied");
        if (label) label.textContent = original;
      }, 1800);
    });
  });

  const reveals = Array.from(document.querySelectorAll(".reveal"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || !("IntersectionObserver" in window)) {
    reveals.forEach((element) => element.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    reveals.forEach((element) => observer.observe(element));
  }

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  // Warm the lazy screenshots shortly after the first paint so switching tabs feels instant.
  window.setTimeout(() => {
    document.querySelectorAll("[data-shot-img]").forEach((image) => {
      image.loading = "eager";
    });
  }, 1200);
})();
