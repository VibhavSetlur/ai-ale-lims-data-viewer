/**
 * Home / landing page for the AI-ALE Research Viewer.
 *
 * Public-facing. Orients a visitor to what the dataset is and routes into the
 * analysis surfaces. Deliberately contains NO provenance / snapshot / source /
 * barcode metadata (that lives in the Reference section and the header dialog).
 */

import Link from "next/link";

interface WorkflowCard {
  href: string;
  group: string;
  title: string;
  description: string;
}

const WORKFLOW_CARDS: readonly WorkflowCard[] = [
  {
    href: "/mutations/compare/mutations",
    group: "Analyze",
    title: "Mutation explorer",
    description:
      "Compare mutation annotations across samples with an interactive heatmap, per-mutation detail, and figure export.",
  },
  {
    href: "/mutations/compare/growth",
    group: "Analyze",
    title: "Growth curves",
    description:
      "Trace optical-density trajectories across transfers with overlays, small multiples, and log scaling.",
  },
  {
    href: "/mutations/compare/library-variants",
    group: "Analyze",
    title: "Library variants",
    description:
      "Study barcode and library-variant abundance with stacked bars, heatmaps, and pairing matrices.",
  },
  {
    href: "/mutations/compare/copy-number",
    group: "Analyze",
    title: "Copy number",
    description:
      "Follow regional copy-number trajectories across lineages and transfers.",
  },
  {
    href: "/tables",
    group: "Explore",
    title: "Data tables",
    description:
      "Browse, filter, sort, and export the underlying curated snapshot tables directly.",
  },
  {
    href: "/plates",
    group: "Design",
    title: "Plate designer",
    description:
      "Build and export 96-well plate layouts locally in your browser. Drafts never write to the LIMS.",
  },
] as const;

const HIGHLIGHTS: readonly { title: string; body: string }[] = [
  {
    title: "Adaptive laboratory evolution",
    body: "Track how engineered and evolved strains change across serial transfers, from mutations to growth to library composition.",
  },
  {
    title: "Interactive, not static",
    body: "Every chart is explorable. Filter cohorts, isolate lineages, drill into a single mutation, and export publication-ready figures.",
  },
  {
    title: "Ask the assistant",
    body: "Use the research assistant in the right panel to ask questions about the data, the analyses, and how to interpret them.",
  },
];

export default function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero">
        <p className="home-eyebrow">AI-ALE research viewer</p>
        <h1 className="home-title">
          Explore the AI-ALE adaptive laboratory evolution dataset
        </h1>
        <p className="home-subtitle">
          An interactive workspace for browsing mutations, growth dynamics, and
          library variants from serial-transfer evolution experiments. Pick an
          analysis below or start with the raw tables.
        </p>
        <div className="home-cta">
          <Link href="/mutations/compare/mutations" className="button button-primary">
            Open mutation explorer
          </Link>
          <Link href="/tables" className="button button-secondary">
            Browse tables
          </Link>
        </div>
      </section>

      <section className="home-highlights" aria-label="Highlights">
        {HIGHLIGHTS.map((h) => (
          <div key={h.title} className="home-highlight">
            <p className="home-highlight-title">{h.title}</p>
            <p className="home-highlight-body">{h.body}</p>
          </div>
        ))}
      </section>

      <section aria-label="Workflows">
        <h2 className="home-section-title">Workflows</h2>
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
      </section>
    </div>
  );
}
