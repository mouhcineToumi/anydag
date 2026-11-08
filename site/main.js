/* AnyDag.com — the two things this page does: switch the theme, and name the visitor's platform on
   the download button. No analytics, no cookies, no third-party requests. */

(() => {
  const root = document.documentElement;
  const toggle = document.querySelector(".theme");

  function store(theme) {
    try {
      localStorage.setItem("anydag-site-theme", theme);
    } catch {
      /* A browser that refuses storage still gets the theme for this visit. */
    }
  }

  function paint(theme) {
    root.dataset.theme = theme;
    if (!toggle) return;
    const next = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to ${next} theme`);
    toggle.title = `Switch to ${next} theme`;
  }

  paint(root.dataset.theme === "dark" ? "dark" : "light");

  toggle?.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    paint(theme);
    store(theme);
  });

  /* Follow the system while the visitor has not made a choice of their own. */
  const system = matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", (event) => {
    let chosen = null;
    try {
      chosen = localStorage.getItem("anydag-site-theme");
    } catch {
      /* Same as above. */
    }
    if (chosen !== "light" && chosen !== "dark") paint(event.matches ? "dark" : "light");
  });

  /* The platform, named on the button. The link is the same Releases page either way; the label and
     the highlighted card are what change. */
  const RELEASES = "https://github.com/mouhcineToumi/anydag/releases/latest";
  const ua = navigator.userAgent;
  const hinted = (navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const mobile = /android|iphone|ipad|ipod/i.test(ua);
  const platform = mobile
    ? "unknown"
    : /mac/.test(hinted) || /macintosh|mac os x/i.test(ua)
      ? "mac"
      : /win/.test(hinted) || /windows/i.test(ua)
        ? "windows"
        : /linux|x11/.test(hinted) || /linux/i.test(ua)
          ? "linux"
          : "unknown";

  const labels = {
    linux: "Download for Linux",
    windows: "Download for Windows",
    mac: "Download for macOS",
    unknown: "Download the latest release",
  };
  const notes = {
    linux: "The latest AppImage for Linux x64. Windows and macOS are on the same page.",
    windows: "The latest installer for Windows x64. Linux and macOS are on the same page.",
    mac: "The latest builds for macOS. Choose Apple Silicon or Intel on the release page.",
    unknown: "Choose the file for Linux, Windows or macOS on the release page.",
  };

  for (const button of document.querySelectorAll("[data-download]")) {
    button.setAttribute("href", RELEASES);
    if (button.id === "cta-primary" || button.id === "cta-download") {
      const icon = button.querySelector("svg");
      button.textContent = labels[platform];
      if (icon) button.append(icon);
    }
  }

  const note = document.getElementById("platform-note");
  if (note) note.textContent = notes[platform];

  for (const card of document.querySelectorAll(`.platform[data-platform="${platform}"]`)) {
    card.classList.add("is-detected");
    const tag = card.querySelector(".platform__tag");
    if (tag) tag.hidden = false;
  }
})();
