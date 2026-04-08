import { useEffect } from "react";

export default function useMobileOverlayLock(locked) {
  useEffect(() => {
    if (!locked || typeof window === "undefined") return undefined;

    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    body.dataset.overlayScrollY = String(scrollY);
    body.classList.add("klinip-overlay-open");
    root.classList.add("klinip-overlay-open");
    body.style.top = `-${scrollY}px`;
    body.style.setProperty("--klinip-scroll-y", `${scrollY}px`);

    return () => {
      const savedScrollY = Number(body.dataset.overlayScrollY || scrollY || 0);
      body.classList.remove("klinip-overlay-open");
      root.classList.remove("klinip-overlay-open");
      body.style.top = "";
      body.style.removeProperty("--klinip-scroll-y");
      delete body.dataset.overlayScrollY;
      window.scrollTo(0, savedScrollY);
    };
  }, [locked]);
}
