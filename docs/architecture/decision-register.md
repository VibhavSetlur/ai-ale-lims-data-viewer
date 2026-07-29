# Viewer 2.0 decision register

- **Release baseline:** Viewer 2.0.0 begins as a clean-slate application on `feat/viewer-2-clean-slate`, based on commit `3e463b6bfcad86d1c153740f5ce60683fd35a214`.
- **Deployment:** No deploy is created or changed by this foundation. Poplar topology, service manager, nginx configuration, and runtime environment remain discovery work.
- **Scientific source:** The initial planned anonymous source is a dev-branch scientific snapshot. Natascha Spahr owns future scientific snapshots and their context.
- **Identity:** Anyone with ORCID may later save their own private work. Authentication and persistence are not active in this foundation.
- **Configuration:** Future local deployment configuration is read from a local environment file and remains outside version control. Parsed configuration is not activated at runtime.
- **Data planes:** Future scientific and operational databases remain distinct. Database URLs never enter public configuration.
- **WP1 validation:** Zod is the single runtime validator for shared API contracts. Its inferred types keep route inputs and response shapes aligned with runtime parsing.
- **WP1 MySQL:** `mysql2` is the MySQL driver. It provides parameterized queries and a promise API without introducing an ORM or a database connection in this foundation.
- **WP1 migrations:** Umzug is the migration runner. Future operational migrations are ordered and ledger-backed; no migration or database connection is created in WP1.
- **WP1 E2E:** Playwright is the browser E2E framework. No browser test is added before a user-facing route exists.
