import type { ButtonHTMLAttributes, ComponentProps, DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type DListHTMLAttributes = HTMLAttributes<HTMLDListElement>;
import NextLink from "next/link";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" };
type NativeDivProps = HTMLAttributes<HTMLDivElement>;

export function Button({ children, className, variant = "primary", ...props }: Readonly<ButtonProps>) {
  return <button className={["button", `button-${variant}`, className].filter(Boolean).join(" ")} {...props}>{children}</button>;
}

export function Link({ className, children, ...props }: Readonly<ComponentProps<typeof NextLink>>) {
  return <NextLink className={["text-link", className].filter(Boolean).join(" ")} {...props}>{children}</NextLink>;
}

export function Panel({ children, className, ...props }: Readonly<NativeDivProps>) {
  return <section className={["panel", className].filter(Boolean).join(" ")} {...props}>{children}</section>;
}

export function SectionHeader({ eyebrow, title, children, className, ...props }: Readonly<NativeDivProps & { eyebrow?: string; title: ReactNode }>) {
  return <header className={["section-header", className].filter(Boolean).join(" ")} {...props}>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2>{children}</header>;
}

export function Metric({ label, value, detail, className, ...props }: Readonly<DListHTMLAttributes & { label: string; value: ReactNode; detail?: ReactNode }>) {
  return <dl className={["metric", className].filter(Boolean).join(" ")} {...props}><dt>{label}</dt><dd>{value}{detail && <small>{detail}</small>}</dd></dl>;
}

export function Toolbar({ children, className, ...props }: Readonly<NativeDivProps>) {
  return <div className={["toolbar", className].filter(Boolean).join(" ")} {...props}>{children}</div>;
}

export function Disclosure({ children, className, ...props }: Readonly<DetailsHTMLAttributes<HTMLDetailsElement>>) {
  return <details className={["disclosure", className].filter(Boolean).join(" ")} {...props}>{children}</details>;
}

export function PageHeader({ eyebrow, title, children }: Readonly<{ eyebrow?: string; title: string; children?: ReactNode }>) {
  return <header className="page-header">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children}</header>;
}

export function InlineNotice({ children, tone = "info" }: Readonly<{ children: ReactNode; tone?: "info" | "warning" }>) {
  return <p className={`notice notice-${tone}`} role={tone === "warning" ? "alert" : "status"}>{children}</p>;
}

export function Skeleton({ label = "Loading content" }: Readonly<{ label?: string }>) {
  return <div className="skeleton" aria-label={label} aria-busy="true" />;
}

export function ProvenanceBadge({ label }: Readonly<{ label: string }>) {
  return <span className="provenance">Snapshot: {label}</span>;
}
