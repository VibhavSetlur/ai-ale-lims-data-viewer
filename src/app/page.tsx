import { AppShell } from "@/components/app-shell/AppShell";
import { StatusChip } from "@/components/design-system/StatusChip";

const foundations = [
  ["Research snapshots", "A public dev snapshot is planned for anonymous exploration, with provenance kept visible."],
  ["Personal workspaces", "ORCID sign-in is planned only for saving private work. It is not active yet."],
  ["Scientific stewardship", "Natascha Spahr will own future scientific snapshots and their release context."],
];

export default function Home() {
  return (
    <AppShell>
      <section className="hero" aria-labelledby="viewer-title">
        <p className="eyebrow">AI-ALE / VIEWER 2.0</p>
        <h1 id="viewer-title">Live research, built with its evidence in view.</h1>
        <p className="lede">A new home for exploring AI-ALE scientific snapshots, tracing their provenance, and later preserving your own research context.</p>
        <div className="status-row" aria-label="Current foundation status">
          <StatusChip label="Foundation" />
          <span>No data, authentication, or database is active.</span>
        </div>
      </section>
      <section className="foundation-grid" aria-label="Planned foundations">
        {foundations.map(([title, description], index) => (
          <article className="foundation-card" key={title}>
            <span className="card-number">0{index + 1}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <section className="signal" aria-labelledby="next-title">
        <div>
          <p className="eyebrow">NEXT SIGNAL</p>
          <h2 id="next-title">Nothing is being simulated.</h2>
        </div>
        <p>The research catalog, results, provenance records, and sign-in flow will appear only after their underlying services are ready. Until then, this page is a transparent starting point.</p>
      </section>
    </AppShell>
  );
}
