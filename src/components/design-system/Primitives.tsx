import type { ButtonHTMLAttributes, ReactNode } from "react";
import NextLink from "next/link";

export function Button({ children, ...props }: Readonly<ButtonHTMLAttributes<HTMLButtonElement>>) { return <button className="button" {...props}>{children}</button>; }
export function Link({ href, children }: Readonly<{ href: string; children: ReactNode }>) { return <NextLink className="text-link" href={href}>{children}</NextLink>; }
export function PageHeader({ eyebrow, title, children }: Readonly<{ eyebrow?: string; title: string; children?: ReactNode }>) { return <header className="page-header">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children}</header>; }
export function InlineNotice({ children, tone = "info" }: Readonly<{ children: ReactNode; tone?: "info" | "warning" }>) { return <p className={`notice notice-${tone}`} role={tone === "warning" ? "alert" : "status"}>{children}</p>; }
export function Skeleton({ label = "Loading content" }: Readonly<{ label?: string }>) { return <div className="skeleton" aria-label={label} aria-busy="true" />; }
export function ProvenanceBadge({ label }: Readonly<{ label: string }>) { return <span className="provenance">Snapshot: {label}</span>; }
