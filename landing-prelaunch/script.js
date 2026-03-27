(function bootstrapPrelaunchLanding() {
  const storageKey = "klinip_prelaunch_theme";
  const config = window.KLINIP_PRELAUNCH_CONFIG || {};
  const root = document.documentElement;
  const body = document.body;

  function applyTheme(theme) {
    body.setAttribute("data-theme", theme);
    root.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      // Ignore storage errors in private browsing.
    }
  }

  function resolvePreferredTheme() {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Ignore storage errors in private browsing.
    }

    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function bindLink(selector, url) {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element) => {
      if (!url) {
        element.setAttribute("data-disabled", "true");
        element.setAttribute("aria-disabled", "true");
        element.href = "#";
        return;
      }

      element.removeAttribute("data-disabled");
      element.removeAttribute("aria-disabled");
      element.href = url;
    });
  }

  applyTheme(resolvePreferredTheme());

  const themeToggle = document.querySelector("[data-theme-toggle]");
  themeToggle?.addEventListener("click", () => {
    const nextTheme = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
  });

  bindLink("[data-app-link]", config.appUrl);
  bindLink("[data-waitlist-link]", config.waitlistUrl);
  bindLink("[data-payment-link]", config.paymentUrl || config.plusPlanUrl || config.familyPlanUrl);
  bindLink("[data-plus-link]", config.plusPlanUrl || config.paymentUrl);
  bindLink("[data-family-link]", config.familyPlanUrl || config.paymentUrl);
  bindLink("[data-whatsapp-link]", config.whatsappUrl);
  bindLink("[data-email-link]", config.emailUrl);
})();
