# Documentation

Documentation for the AI-ALE LIMS Data Viewer. Start with the project
[`README`](../README.md) for setup and a feature overview; the documents here go
deeper.

| Document | Read it for | Audience |
|---|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, the dual server/static run modes, the data-driven dual-deployment model, the full re-deploy procedure, and pitfalls | Developers, maintainers |
| [`DATA_MODEL.md`](DATA_MODEL.md) | The LIMS tables the views depend on and how the viewer maps them; the provenance rule | Reviewers, anyone reproducing a value |
| [`RESEARCHER_GUIDE.md`](RESEARCHER_GUIDE.md) | How a biologist actually uses the viewer: selecting samples, reading the heatmap and copy-number trajectories, growth curves, barcode charts, and exporting publication figures | Researchers, reviewers |
| [`MANUSCRIPT_INTEGRATION.md`](MANUSCRIPT_INTEGRATION.md) | Ready-to-adapt Methods / Results / figure-legend language plus the honesty guardrails for citing viewer figures | Authors writing the paper |

The `RESEARCHER_GUIDE.md` is also served inside the app: the left sidebar's
**Help & guide** opens a searchable copy, and the **Interactive tutorial** walks
through the same workflows on the live UI.

## Conventions

- These docs describe the committed codebase and are kept in sync with it. When a
  feature changes, the doc and the in-app Help/Tutorial are updated together.
- No deploy secrets, server paths private to one host, or point-in-time meeting
  notes live here. Operational notes that are not part of the public record are
  kept outside the repository.
- Style: plain English, no em-dashes, examples over prose.
