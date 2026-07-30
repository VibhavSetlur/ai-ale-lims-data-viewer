/**
 * Home dashboard -- entry point for AI-ALE Research Viewer.
 *
 * Renders six workflow cards. Context rail snapshot info is provided
 * by the AppShell itself (which fetches /api/v1/status on mount).
 *
 * Navigation to workflow cards does NOT depend on status load.
 */

import Link from "next/link";

// ---- Workflow cards ----

interface WorkflowCard {
  href: string;
  group: string;
  title: string;
  description: string;
}

const WORKFLOW_CARDS: readonly WorkflowCard[] = [
  {
    href: "/tables",
    group: "Explore",
    title: "Browse tables",
    description:
      "Filter, sort, and export raw scientific snapshot data. Start here to understand available records.",
  },
  {
    href: "/mutations/cohort",
    group: "Analyze",
    title: "Build a cohort",
    description:
      "Select samples and experimental conditions to define a cohort for downstream analysis.",
  },
  {
    href: "/mutations/compare/mutations",
    group: "Analyze",
    title: "Compare mutations",
    description:
      "Summarize observed mutation annotations across the selected cohort and compare conditions.",
  },
  {
    href: "/mutations/compare/growth",
    group: "Analyze",
    title: "Growth series",
    description:
      "Visualize growth trajectories over experimental transfers. Review caveats in the guide before interpreting results.",
  },
  {
    href: "/plates",
    group: "Design",
    title: "Design plates",
    description:
      "Build and export plate layouts locally in your browser. Drafts never write to LIMS.",
  },
  {
    href: "/workspaces",
    group: "Workspace",
    title: "Resume work",
    description:
      "Return to a saved workspace or start a new analysis session from where you left off.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="home-page">
      <div className="home-headline">
        <h1 className="home-title">AI-ALE Research Viewer</h1>
        <p className="home-subtitle">
          Explore scientific snapshots from the AI-ALE LIMS. All data shown here
          is read-only. Navigate to a workflow to begin.
        </p>
      </div>

      <div className="workflow-grid" role="list">
        {WORKFLOW_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="workflow-card"
            role="listitem"
            data-testid={`workflow-card-${card.href.replace(/\//g, "-").replace(/^-/, "")}`}
          >
            <p className="workflow-card-label">{card.group}</p>
            <p className="workflow-card-title">{card.title}</p>
            <p className="workflow-card-desc">{card.description}</p>
            <p className="workflow-card-arrow" aria-hidden="true">
              Open &rarr;
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
