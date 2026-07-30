'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Research",
    links: [
      { href: "/tables", label: "Explore data" },
      { href: "/mutations/cohort", label: "Build a cohort" },
      { href: "/mutations/compare/mutations", label: "Analyze" },
      { href: "/plates", label: "Design plates" },
      { href: "/workspaces", label: "Resume work" },
    ],
  },
  {
    label: "Support",
    links: [
      { href: "/guide", label: "Guide" },
      { href: "/changelog", label: "Changelog" },
      { href: "/help", label: "Help" },
    ],
  },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/tables") return pathname === href || pathname.startsWith("/tables/");
  if (href === "/mutations/compare/mutations") return pathname.startsWith("/mutations/compare");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {groups.map((group) => (
        <section className="nav-section" aria-labelledby={`nav-${group.label.toLowerCase()}`} key={group.label}>
          <h2 className="nav-group" id={`nav-${group.label.toLowerCase()}`}>{group.label}</h2>
          <div className="nav-links">
            {group.links.map((link) => {
              const active = isActive(pathname, link.href);
              return <Link aria-current={active ? "page" : undefined} className={active ? "nav-link is-active" : "nav-link"} href={link.href} key={link.href}>{link.label}</Link>;
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
