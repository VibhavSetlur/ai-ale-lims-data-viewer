"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

// ---- Types ----

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  persistent?: boolean; // errors are persistent by default
}

interface ToastContextValue {
  add: (variant: ToastVariant, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ---- Provider ----

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = String(++idRef.current);
      const persistent = variant === "error";
      setToasts((prev) => [...prev, { id, variant, message, persistent }]);
      if (!persistent) {
        setTimeout(() => dismiss(id), 6000);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      <div
        className="toast-region"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Individual toast ----

function ToastItem({
  toast,
  onDismiss,
}: Readonly<{ toast: ToastItem; onDismiss: () => void }>) {
  const labelId = useId();
  const role = toast.variant === "error" ? "alert" : "status";

  return (
    <div
      className={`toast toast-${toast.variant}`}
      role={role}
      aria-labelledby={labelId}
    >
      <span id={labelId} className="toast-message" style={{ flex: 1 }}>
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="drawer-close"
        style={{ minHeight: "unset" }}
      >
        x
      </button>
    </div>
  );
}

// ---- Hook ----

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
