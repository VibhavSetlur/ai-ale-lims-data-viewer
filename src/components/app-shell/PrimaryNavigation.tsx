"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ---- Nav groups (spec section 3.2) ----

interface NavLink {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  id: string;
  links: readonly NavLink[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Explore",
    id: "explore",
    links: [{ href: "/tables", label: "Tables" }],
  },
  {
    label: "Analyze",
    id: "analyze",
    links: [
      { href: "/mutations/cohort", label: "Cohort" },
      { href: "/mutations/compare/mutations", label: "Mutations" },
      { href: "/mutations/compare/growth", label: "Growth" },
      { href: "/mutations/compare/library-variants", label: "Library variants" },
      { href: "/mutations/compare/copy-number", label: "Copy number" },
    ],
  },
  {
    label: "Design",
    id: "design",
    links: [{ href: "/plates", label: "Plates" }],
  },
  {
    label: "Workspace",
    id: "workspace",
    links: [{ href: "/workspaces", label: "Workspaces" }],
  },
  {
    label: "Reference",
    id: "reference",
    links: [
      { href: "/guide", label: "Guide" },
      { href: "/changelog", label: "Changelog" },
      { href: "/help", label: "Help" },
    ],
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  // Exact match for top-level routes
  if (href === "/tables") {
    return pathname === href || pathname.startsWith("/tables/");
  }
  // /mutations/compare/* -- each sub-route is a distinct active link
  if (href.startsWith("/mutations/compare/")) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  // /mutations/cohort is active only at that exact prefix
  if (href === "/mutations/cohort") {
    return pathname === href || pathname.startsWith("/mutations/cohort/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNavigation({
  onNavigate,
}: Readonly<{ onNavigate?: () => void }>) {
  const pathname = usePathname();

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {NAV_GROUPS.map((group) => (
        <section
          key={group.id}
          aria-labelledby={`nav-group-${group.id}`}
        >
          <h2
            className="nav-group-label"
            id={`nav-group-${group.id}`}
          >
            {group.label}
          </h2>
          <div>
            {group.links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`nav-link${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
