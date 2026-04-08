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

    /* Fijar el body para impedir scroll SIN mover su posición visual.
       Usamos top negativo + position:fixed (CSS) para congelar el
       scroll, pero compensamos con un wrapper en vez de mover el body.
       NUEVO: dejamos el body quieto y solo bloqueamos overflow. */
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      const savedScrollY = Number(body.dataset.overlayScrollY || scrollY || 0);
      body.classList.remove("klinip-overlay-open");
      root.classList.remove("klinip-overlay-open");
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      delete body.dataset.overlayScrollY;
      window.scrollTo(0, savedScrollY);
    };
  }, [locked]);
}
