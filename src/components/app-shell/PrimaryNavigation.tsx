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
    label: "Analyze",
    id: "analyze",
    links: [{ href: "/mutations", label: "Mutation Explorer" }],
  },
  {
    label: "Explore",
    id: "explore",
    links: [{ href: "/tables", label: "Data Tables" }],
  },
  {
    label: "Design",
    id: "design",
    links: [{ href: "/plates", label: "Plate Design" }],
  },
  {
    label: "Workspace",
    id: "workspace",
    links: [{ href: "/workspaces", label: "Saved plates" }],
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
  if (href === "/tables") {
    return pathname === href || pathname.startsWith("/tables/");
  }
  // Mutation Explorer owns /mutations and all legacy /mutations/* redirects.
  if (href === "/mutations") {
    return pathname === href || pathname.startsWith("/mutations/");
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
