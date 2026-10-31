import { els } from "./dom";

export function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("downlink.theme", theme);
  els.themeIcon?.setAttribute(
    "href",
    theme === "dark" ? "#i-sun" : "#i-moon",
  );
  els.themeIconTop?.setAttribute(
    "href",
    theme === "dark" ? "#i-sun" : "#i-moon",
  );
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0b0e0f" : "#f3f5ee";
}

export function initTheme(): void {
  const saved = localStorage.getItem("downlink.theme");
  const preferred =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  applyTheme(preferred);
}
