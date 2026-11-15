// ────────────────────────────────────
// Dark / Light Theme Toggle
// ────────────────────────────────────
(() => {
  const toggle = document.getElementById("themeToggle");
  const html = document.documentElement;
  let saved;
  try { saved = localStorage.getItem("theme"); } catch {}
  if (saved) html.setAttribute("data-theme", saved);
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.setAttribute("data-theme", "dark");
  }
  toggle.setAttribute("aria-pressed", html.getAttribute("data-theme") === "dark");
  toggle.addEventListener("click", () => {
    const current = html.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    toggle.setAttribute("aria-pressed", next === "dark");
    try { localStorage.setItem("theme", next); } catch {}
    document.dispatchEvent(new Event("themechange"));
  });
})();

