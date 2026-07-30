"use client";

import { useCallback, useEffect, useRef } from "react";
import { PrimaryNavigation } from "./PrimaryNavigation";

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNavDrawer({
  open,
  onClose,
}: Readonly<MobileNavDrawerProps>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      // Give the drawer time to render before focusing
      requestAnimationFrame(() => {
        closeBtnRef.current?.focus();
      });
    } else {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    }
  }, [open]);

  const trapFocus = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className="drawer-overlay drawer-left"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      onKeyDown={trapFocus}
    >
      <div className="drawer-panel" ref={panelRef} tabIndex={-1}>
        <div className="drawer-header">
          <h2 className="drawer-title">Navigation</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            x
          </button>
        </div>
        <PrimaryNavigation onNavigate={onClose} />
      </div>
    </div>
  );
}
