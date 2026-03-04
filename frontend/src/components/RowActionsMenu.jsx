import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function RowActionsMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0 });
  const visibleItems = useMemo(() => items.filter(Boolean), [items]);

  const updateMenuPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportPad = 8;
    const menuWidth = 170;
    const estimatedHeight = visibleItems.length * 38 + 16;
    const nextLeft = Math.max(
      viewportPad,
      Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPad)
    );
    let nextTop = rect.bottom + 8;
    if (nextTop + estimatedHeight > window.innerHeight - viewportPad) {
      nextTop = Math.max(viewportPad, rect.top - estimatedHeight - 8);
    }
    setMenuStyle({ top: Math.round(nextTop), left: Math.round(nextLeft) });
  };

  useEffect(() => {
    const onPointerDown = (event) => {
      const insideTrigger = triggerRef.current?.contains(event.target);
      const insideMenu = menuRef.current?.contains(event.target);
      if (!insideTrigger && !insideMenu) {
        setOpen(false);
      }
    };
    const onEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onViewportChange = () => updateMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, visibleItems.length]);

  if (!visibleItems.length) return null;

  return (
    <div className="row-actions">
      <button
        ref={triggerRef}
        type="button"
        className="row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Abrir acciones"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span />
        <span />
        <span />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="row-actions-menu" role="menu" style={menuStyle}>
            {visibleItems.map((item) => (
              <button
                key={item.key || item.label}
                type="button"
                role="menuitem"
                className={`row-actions-item ${item.danger ? "is-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
