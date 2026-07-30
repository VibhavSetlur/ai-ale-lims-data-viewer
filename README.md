# AI-ALE Live Research Viewer 2.0

A clean-slate foundation for the future live research viewer. This repository currently renders an honest product foundation only: no scientific data, authentication, database connection, API route, deployment, or persistence is active.

The planned anonymous source is a public dev snapshot owned scientifically by Natascha Spahr. A future ORCID sign-in may let people save their own private work without changing the public research snapshot.

## Local development

```bash
npm ci
npm run dev
```

Use `.env.example` as the shape for local configuration. Configuration parsing is intentionally not activated by the UI or runtime yet.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
