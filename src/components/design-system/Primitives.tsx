"use client";

/**
 * Primitives.tsx -- Design system primitives for AI-ALE Research Viewer
 *
 * All values reference CSS tokens from styles.css.
 * No raw hex or px values here.
 */

import type {
  ButtonHTMLAttributes,
  ComponentProps,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import NextLink from "next/link";

type DivProps = HTMLAttributes<HTMLDivElement>;

// ---- Button ----

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "md" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  loading = false,
  iconLeft,
  disabled,
  ...props
}: Readonly<ButtonProps>) {
  return (
    <button
      className={[
        "button",
        `button-${variant}`,
        size === "sm" ? "button-sm" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {iconLeft && <span aria-hidden="true">{iconLeft}</span>}
      {loading ? (
        <span aria-live="polite" aria-label="Loading">
          Loading...
        </span>
      ) : (
        children
      )}
    </button>
  );
}

// ---- IconButton ----

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  "aria-label": string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function IconButton({
  className,
  size = "md",
  variant = "ghost",
  ...props
}: Readonly<IconButtonProps>) {
  return (
    <button
      className={[
        "button",
        `button-${variant}`,
        "button-icon-only",
        size === "sm" ? "button-sm" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

// ---- Link ----

export function Link({
  className,
  children,
  ...props
}: Readonly<ComponentProps<typeof NextLink>>) {
  return (
    <NextLink
      className={["text-link", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </NextLink>
  );
}

// ---- Panel ----

type PanelProps = DivProps & { title?: ReactNode; actions?: ReactNode };

export function Panel({
  children,
  className,
  title,
  actions,
  ...props
}: Readonly<PanelProps>) {
  return (
    <section className={["panel", className].filter(Boolean).join(" ")} {...props}>
      {title && <SectionHeader title={title} actions={actions} />}
      {children}
    </section>
  );
}

// ---- SectionHeader ----

type SectionHeaderProps = {
  title: ReactNode;
  description?: string;
  /** Legacy alias for description */
  eyebrow?: string;
  actions?: ReactNode;
  /** Additional content rendered below the title row */
  children?: ReactNode;
  className?: string;
};

export function SectionHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: Readonly<SectionHeaderProps>) {
  const descText = description ?? eyebrow;
  return (
    <div className={["section-header", className].filter(Boolean).join(" ")}>
      <div className="section-header-text">
        <h2 className="section-header-title">{title}</h2>
        {descText && (
          <p className="section-header-desc">{descText}</p>
        )}
      </div>
      {actions && (
        <div className="section-header-actions">{actions}</div>
      )}
      {children}
    </div>
  );
}

// ---- PageHeader (preserved for feature pages) ----

export function PageHeader({
  eyebrow,
  title,
  children,
}: Readonly<{ eyebrow?: string; title: string; children?: ReactNode }>) {
  return (
    <header className="page-header">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-2)" }}>{title}</h1>
      {children}
    </header>
  );
}

// ---- Metric ----

type MetricProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Legacy alias for hint */
  detail?: ReactNode;
  className?: string;
};

export function Metric({
  label,
  value,
  hint,
  detail,
  className,
}: Readonly<MetricProps>) {
  const hintContent = hint ?? detail;
  return (
    <dl className={["metric", className].filter(Boolean).join(" ")}>
      <dt>{label}</dt>
      <dd>
        {value}
        {hintContent && <span className="metric-hint">{hintContent}</span>}
      </dd>
    </dl>
  );
}

// ---- Toolbar ----

export function Toolbar({
  children,
  className,
  ...props
}: Readonly<DivProps>) {
  return (
    <div className={["toolbar", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}

// ---- Disclosure ----

type DisclosureProps = {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: Readonly<DisclosureProps>) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();
  const contentId = `disclosure-${baseId}`;

  return (
    <div className={["disclosure", className].filter(Boolean).join(" ")}>
      <summary
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={contentId}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        {summary}
      </summary>
      {open && (
        <div
          id={contentId}
          className="disclosure-body"
          role="region"
          aria-label={typeof summary === "string" ? summary : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---- Field ----

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: Readonly<FieldProps>) {
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- TextInput ----

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export function TextInput({
  className,
  error,
  ...props
}: Readonly<TextInputProps>) {
  return (
    <input
      type="text"
      className={["text-input", className].filter(Boolean).join(" ")}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

// ---- NumberInput ----

export function NumberInput({
  className,
  ...props
}: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <input
      type="number"
      className={["number-input", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

// ---- Select ----

export function Select({
  className,
  children,
  ...props
}: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  return (
    <select
      className={["select-input", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </select>
  );
}

// ---- Checkbox ----

type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

export function Checkbox({
  label,
  className,
  id,
  ...props
}: Readonly<CheckboxProps>) {
  return (
    <label className={["checkbox-wrapper", className].filter(Boolean).join(" ")}>
      <input
        id={id}
        type="checkbox"
        className="checkbox-input"
        {...props}
      />
      {label}
    </label>
  );
}

// ---- Chip ----

type ChipProps = {
  children: ReactNode;
  onRemove?: () => void;
  className?: string;
};

export function Chip({
  children,
  onRemove,
  className,
}: Readonly<ChipProps>) {
  return (
    <span className={["chip", className].filter(Boolean).join(" ")}>
      {children}
      {onRemove && (
        <button
          type="button"
          className="chip-remove"
          onClick={onRemove}
          aria-label={`Remove ${typeof children === "string" ? children : "item"}`}
        >
          x
        </button>
      )}
    </span>
  );
}

// ---- Badge ----

export type BadgeVariant = "info" | "success" | "warning" | "danger" | "neutral";

type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

export function Badge({
  children,
  variant = "neutral",
  className,
}: Readonly<BadgeProps>) {
  return (
    <span
      className={["badge", `badge-${variant}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

// ---- EmptyState ----

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: Readonly<EmptyStateProps>) {
  return (
    <div className={["empty-state", className].filter(Boolean).join(" ")}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
      {action}
    </div>
  );
}

// ---- ErrorState ----

type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({
  message,
  onRetry,
  className,
}: Readonly<ErrorStateProps>) {
  return (
    <div
      className={["error-state", className].filter(Boolean).join(" ")}
      role="alert"
    >
      <p className="error-state-message">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ---- LoadingState ----

type LoadingStateProps = {
  rows?: number;
  label?: string;
  className?: string;
};

export function LoadingState({
  rows = 3,
  label = "Loading content",
  className,
}: Readonly<LoadingStateProps>) {
  return (
    <div
      className={["loading-state", className].filter(Boolean).join(" ")}
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

// ---- Skeleton (preserved alias) ----

export function Skeleton({ label = "Loading content" }: Readonly<{ label?: string }>) {
  return <LoadingState rows={3} label={label} />;
}

// ---- Table ----

type TableProps = {
  caption?: string;
  children: ReactNode;
  className?: string;
};

export function Table({
  caption,
  children,
  className,
}: Readonly<TableProps>) {
  return (
    <div className="data-table-wrapper">
      <table
        className={["data-table", className].filter(Boolean).join(" ")}
      >
        {caption && <caption>{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  ...props
}: Readonly<ThHTMLAttributes<HTMLTableCellElement>>) {
  return (
    <th scope="col" className={className} {...props}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...props
}: Readonly<TdHTMLAttributes<HTMLTableCellElement>>) {
  return (
    <td className={className} {...props}>
      {children}
    </td>
  );
}

// ---- Drawer ----

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
};

export function Drawer({
  open,
  onClose,
  title,
  side = "right",
  children,
}: Readonly<DrawerProps>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      closeBtnRef.current?.focus();
    } else {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    }
  }, [open]);

  const trapFocus = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [onClose]);

  if (!open) return null;

  const titleId = "drawer-title";

  return (
    <div
      className={`drawer-overlay ${side === "left" ? "drawer-left" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapFocus}
    >
      <div className="drawer-panel" ref={panelRef} tabIndex={-1}>
        <div className="drawer-header">
          <h2 className="drawer-title" id={titleId}>
            {title}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close panel"
          >
            x
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Dialog ----

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: Readonly<DialogProps>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = "dialog-title";
  const descId = description ? "dialog-desc" : undefined;

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      closeBtnRef.current?.focus();
    } else {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    }
  }, [open]);

  const trapFocus = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={trapFocus}
    >
      <div className="dialog-panel" ref={panelRef} tabIndex={-1}>
        <div className="dialog-header">
          <div>
            <h2 className="dialog-title" id={titleId}>
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-secondary)", marginTop: "var(--space-1)" }}
              >
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            x
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Popover ----

type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  side?: "bottom";
};

export function Popover({
  trigger,
  children,
  side = "bottom",
}: Readonly<PopoverProps>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="popover-wrapper" ref={wrapperRef}>
      <div onClick={() => setOpen(!open)} aria-expanded={open}>
        {trigger}
      </div>
      {open && (
        <div className="popover-panel" data-side={side}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---- Tooltip ----

type TooltipProps = {
  content: string;
  children: ReactNode;
};

export function Tooltip({ content, children }: Readonly<TooltipProps>) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();
  const id = `tooltip-${baseId}`;

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 400);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div
      className="tooltip-wrapper"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <div aria-describedby={visible ? id : undefined}>{children}</div>
      {visible && (
        <div className="tooltip-panel" id={id} role="tooltip">
          {content}
        </div>
      )}
    </div>
  );
}

// ---- InlineNotice (preserved for feature pages) ----

export function InlineNotice({
  children,
  tone = "info",
}: Readonly<{ children: ReactNode; tone?: "info" | "warning" }>) {
  return (
    <p
      className={`notice notice-${tone}`}
      role={tone === "warning" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

// ---- ProvenanceBadge (preserved for feature pages) ----

export function ProvenanceBadge({ label }: Readonly<{ label: string }>) {
  return <span className="provenance">Snapshot: {label}</span>;
}

// ---- Textarea ----

export function Textarea({
  className,
  ...props
}: Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return (
    <textarea
      className={["text-input", className].filter(Boolean).join(" ")}
      style={{ minHeight: "80px", padding: "var(--space-2) var(--space-3)", resize: "vertical" }}
      {...props}
    />
  );
}
