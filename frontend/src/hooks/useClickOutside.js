import { useEffect } from "react";

/**
 * Cierra un overlay cuando se hace click fuera o se presiona Escape.
 *
 * @param {boolean} isOpen - Si el overlay esta abierto.
 * @param {Function} onClose - Callback para cerrar.
 * @param {React.RefObject|React.RefObject[]} refs - Ref(s) de los elementos que NO deben disparar el cierre.
 */
export default function useClickOutside(isOpen, onClose, refs) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const refList = Array.isArray(refs) ? refs : [refs];

    const handlePointerDown = (event) => {
      const inside = refList.some(
        (ref) => ref.current && ref.current.contains(event.target)
      );
      if (!inside) onClose();
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, refs]);
}
