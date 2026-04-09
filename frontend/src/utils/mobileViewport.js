const HANDHELD_LANDSCAPE_MAX_HEIGHT = 600;

function hasCoarsePointer(win) {
  if (!win) return false;
  if (typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches) {
    return true;
  }
  const touchPoints = Number(win.navigator?.maxTouchPoints || 0);
  return touchPoints > 0;
}

export function isHandheldViewport(maxWidth = 768, win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return false;
  const width = Number(win.innerWidth || 0);
  const height = Number(win.innerHeight || 0);
  if (width <= maxWidth) {
    return true;
  }
  return hasCoarsePointer(win) && width > height && height <= HANDHELD_LANDSCAPE_MAX_HEIGHT;
}

