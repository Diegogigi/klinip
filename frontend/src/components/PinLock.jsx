import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrandMark } from "./BrandLogo";
import { hasPin, setPin, verifyPin } from "../utils/pinLock";

const PIN_LENGTH = 4;

function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 5H8.5a2 2 0 0 0-1.5.7L3 12l4 6.3a2 2 0 0 0 1.5.7H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
      <path d="M11 9.5l5 5M16 9.5l-5 5" />
    </svg>
  );
}

export default function PinLock({ user, onUnlock, onLogout, forceSetup = false, onCancel }) {
  const userId = user?.id;
  const firstName = useMemo(() => {
    const name = (user?.name || "").trim();
    return name ? name.split(/\s+/)[0] : "";
  }, [user?.name]);

  // setup = crear PIN; unlock = ingresar PIN existente. forceSetup fuerza la
  // creación (usado desde Ajustes para "crear" o "cambiar" PIN).
  const [mode] = useState(() =>
    forceSetup ? "setup" : hasPin(userId) ? "unlock" : "setup"
  );
  // En setup: stage "create" pide el PIN nuevo y "confirm" lo repite.
  const [stage, setStage] = useState("create");
  const [firstPin, setFirstPin] = useState("");
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgotHint, setForgotHint] = useState(false);

  const triggerError = useCallback((message) => {
    setError(message);
    setShake(true);
    setEntry("");
    window.setTimeout(() => setShake(false), 420);
  }, []);

  const handleComplete = useCallback(
    async (code) => {
      setBusy(true);
      try {
        if (mode === "unlock") {
          const ok = await verifyPin(userId, code);
          if (ok) {
            onUnlock?.();
          } else {
            triggerError("PIN incorrecto. Inténtalo de nuevo.");
          }
          return;
        }
        // setup
        if (stage === "create") {
          setFirstPin(code);
          setEntry("");
          setError("");
          setStage("confirm");
          return;
        }
        // confirm
        if (code === firstPin) {
          await setPin(userId, code);
          onUnlock?.();
        } else {
          setFirstPin("");
          setStage("create");
          triggerError("Los PIN no coinciden. Empecemos de nuevo.");
        }
      } finally {
        setBusy(false);
      }
    },
    [mode, stage, firstPin, userId, onUnlock, triggerError]
  );

  useEffect(() => {
    if (entry.length === PIN_LENGTH && !busy) {
      handleComplete(entry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const pressDigit = useCallback(
    (digit) => {
      if (busy) return;
      setError("");
      setForgotHint(false);
      setEntry((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
    },
    [busy]
  );

  const pressBackspace = useCallback(() => {
    if (busy) return;
    setEntry((prev) => prev.slice(0, -1));
  }, [busy]);

  // Soporte de teclado físico (escritorio).
  useEffect(() => {
    const onKey = (event) => {
      if (event.key >= "0" && event.key <= "9") {
        pressDigit(event.key);
      } else if (event.key === "Backspace") {
        pressBackspace();
      } else if (event.key === "Escape" && onCancel) {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressDigit, pressBackspace, onCancel]);

  const title =
    mode === "setup"
      ? stage === "create"
        ? "Crea tu PIN"
        : "Confirma tu PIN"
      : firstName
      ? `Hola ${firstName}`
      : "Hola de nuevo";

  const subtitle =
    mode === "setup"
      ? stage === "create"
        ? "Elige un PIN de 4 dígitos para proteger tu app."
        : "Vuelve a ingresar el PIN para confirmarlo."
      : "Ingresa tu PIN para continuar";

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="pinlock-backdrop" role="dialog" aria-modal="true" aria-label="Bloqueo de seguridad">
      <div className="pinlock-shell">
        <div className="pinlock-head">
          <BrandMark variant="solid" className="pinlock-logo" imgClassName="pinlock-logo-img" />
          <h1 className="pinlock-title">{title}</h1>
          <p className="pinlock-subtitle">{subtitle}</p>
        </div>

        <div className={`pinlock-dots ${shake ? "is-shake" : ""}`} aria-hidden="true">
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <span
              key={index}
              className={`pinlock-dot ${index < entry.length ? "is-filled" : ""}`}
            />
          ))}
        </div>

        <p className={`pinlock-message ${error ? "is-error" : ""}`} role="status" aria-live="polite">
          {error || (forgotHint ? "Para restaurar tu PIN, cierra sesión y vuelve a entrar." : " ")}
        </p>

        <div className="pinlock-keypad">
          {keypad.map((digit) => (
            <button
              key={digit}
              type="button"
              className="pinlock-key"
              onClick={() => pressDigit(digit)}
              disabled={busy}
            >
              {digit}
            </button>
          ))}
          <span className="pinlock-key pinlock-key-empty" aria-hidden="true" />
          <button
            type="button"
            className="pinlock-key"
            onClick={() => pressDigit("0")}
            disabled={busy}
          >
            0
          </button>
          <button
            type="button"
            className="pinlock-key pinlock-key-action"
            onClick={pressBackspace}
            disabled={busy || entry.length === 0}
            aria-label="Borrar"
          >
            <BackspaceIcon />
          </button>
        </div>

        <div className="pinlock-footer">
          {onCancel ? (
            <button type="button" className="pinlock-link" onClick={() => onCancel()}>
              Cancelar
            </button>
          ) : mode === "unlock" ? (
            <>
              <button
                type="button"
                className="pinlock-link"
                onClick={() => setForgotHint(true)}
              >
                ¿Olvidaste tu PIN?
              </button>
              <button
                type="button"
                className="pinlock-link pinlock-link-strong"
                onClick={() => onLogout?.()}
              >
                Cierra sesión para restaurar el PIN
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pinlock-link"
              onClick={() => onLogout?.()}
            >
              Cerrar sesión
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
