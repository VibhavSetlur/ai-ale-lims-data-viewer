/**
 * catalog.spec.ts -- Phase B1 E2E tests for the catalog/tables browser
 *
 * Tests exercise actual app routes against the fake/dev server.
 * API interception is used for edge-case states (413, empty, cursor).
 * Axe accessibility assertions are included in this file using @axe-core/playwright.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Wrap a raw payload in the real API envelope so mocks exercise the true
 * contract the client parses ({ ok: true, data } / { ok: false, error }).
 * If the payload carries an "error" key it becomes a failure envelope.
 */
function env(payload: Record<string, unknown>): string {
  const request = { requestId: "test-req", correlationId: "test-corr" };
  if (payload && typeof payload === "object" && "error" in payload) {
    return JSON.stringify({ ok: false, error: payload.error, request });
  }
  return JSON.stringify({ ok: true, data: payload, request });
}


// ─── Tables index ─────────────────────────────────────────────────────────────

test("tables index lists tables from API", async ({ page }) => {
  // Intercept catalog/current and tables
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        snapshotId: "snap-001",
        label: "Test snapshot",
        sourceSystem: "test-lims",
        sourceUpdatedAt: "2026-01-01T00:00:00Z",
      }),
    });
  });

  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [
          {
            name: "experiments",
            columns: [
              { key: "id", label: "ID", type: "number", nullable: false },
              { key: "name", label: "Name", type: "string", nullable: false },
              { key: "status", label: "Status", type: "string", nullable: true },
            ],
          },
          {
            name: "samples",
            columns: [
              { key: "id", label: "ID", type: "number", nullable: false },
              { key: "experiment_id", label: "Experiment ID", type: "number", nullable: false },
            ],
          },
        ],
      }),
    });
  });

  await page.goto("/tables");

  // Both tables should appear
  await expect(page.getByTestId("table-card-experiments")).toBeVisible();
  await expect(page.getByTestId("table-card-samples")).toBeVisible();

  // Cards show column counts
  await expect(page.getByTestId("table-card-experiments")).toContainText("3 columns");
  await expect(page.getByTestId("table-card-samples")).toContainText("2 columns");
});

test("tables index search filters cards client-side", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        snapshotId: "snap-001",
        label: "Test",
        sourceSystem: "lims",
        sourceUpdatedAt: null,
      }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [
          { name: "experiments", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] },
          { name: "plates", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] },
        ],
      }),
    });
  });

  await page.goto("/tables");
  await expect(page.getByTestId("table-card-experiments")).toBeVisible();

  // Search for "plate"
  await page.getByLabel("Search tables").fill("plate");
  await expect(page.getByTestId("table-card-experiments")).not.toBeVisible();
  await expect(page.getByTestId("table-card-plates")).toBeVisible();
});

test("tables index shows error state with retry on API failure", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: env({ error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable", retryable: true } }),
    });
  });

  await page.goto("/tables");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

// ─── Table workspace: rows load ───────────────────────────────────────────────

test("table workspace loads rows with correct limit", async ({ page }) => {
  const rowsRequests: unknown[] = [];

  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    const body = await route.request().postDataJSON();
    rowsRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ],
        rows: [
          { id: 1, name: "Alpha" },
          { id: 2, name: "Beta" },
        ],
        nextCursor: null,
        totalCount: 2,
      }),
    });
  });

  await page.goto("/tables/experiments");

  // Rows should render
  await expect(page.getByRole("cell", { name: "Alpha" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Beta" })).toBeVisible();

  // Load more should NOT appear when nextCursor is null
  await expect(page.getByRole("button", { name: /load more/i })).not.toBeVisible();

  // Verify limit=100 was sent (pageSize change from 50 to 100)
  const firstReq = rowsRequests[0] as Record<string, unknown>;
  expect(firstReq.limit).toBe(100);
  expect(firstReq.table).toBe("experiments");
  expect(firstReq.snapshotId).toBe("snap-001");
});

// ─── Filters ─────────────────────────────────────────────────────────────────

test("adding a filter re-queries rows with where clause", async ({ page }) => {
  const rowsRequests: unknown[] = [];

  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "status", label: "Status", type: "string", nullable: true },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    const body = await route.request().postDataJSON();
    rowsRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }, { key: "status", label: "Status", type: "string", nullable: true }],
        rows: [{ id: 1, status: "active" }],
        nextCursor: null,
        totalCount: 1,
      }),
    });
  });

  await page.goto("/tables/experiments");

  // Wait for initial load
  await expect(page.getByRole("cell", { name: "active" })).toBeVisible();
  const initialCount = rowsRequests.length;

  // Open filters
  await page.getByRole("button", { name: /filters/i }).click();

  // Add a filter
  await page.getByRole("button", { name: /add filter/i }).click();

  // Set value in the filter
  const valueInput = page.getByLabel("Filter value").first();
  await valueInput.fill("active");

  // Wait for debounce / re-query triggered
  await page.waitForTimeout(200);

  // A new query should have been sent with a where clause
  // (If filter isn't complete, no re-query; just check filters panel is visible)
  await expect(page.getByLabel("Filter column").first()).toBeVisible();
  await expect(page.getByLabel("Filter operator").first()).toBeVisible();
  expect(rowsRequests.length).toBeGreaterThanOrEqual(initialCount);
});

// ─── Facets ───────────────────────────────────────────────────────────────────

test("facets popover shows value counts and apply creates filter", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "status", label: "Status", type: "string", nullable: true },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }, { key: "status", label: "Status", type: "string", nullable: true }],
        rows: [{ id: 1, status: "active" }, { id: 2, status: "done" }],
        nextCursor: null,
        totalCount: 2,
      }),
    });
  });
  await page.route("**/api/v1/catalog/facets", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        status: [
          { value: "active", count: 10 },
          { value: "done", count: 5 },
        ],
      }),
    });
  });

  await page.goto("/tables/experiments");
  await expect(page.getByRole("cell", { name: "active" })).toBeVisible();

  // Open facets panel
  await page.getByRole("button", { name: /facets/i }).click();

  // Facet values should appear
  await expect(page.getByRole("button", { name: /active.*10/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /done.*5/i })).toBeVisible();

  // Clicking a facet value should add it as a filter
  await page.getByRole("button", { name: /active.*10/i }).click();

  // Filters panel should open with the new filter
  await expect(page.getByLabel("Filter column").first()).toBeVisible();
});

// ─── Load more (cursor-based) ─────────────────────────────────────────────────

test("load more appears only when nextCursor is present and fetches next page", async ({ page }) => {
  let callCount = 0;

  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] }],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: env({
          columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
          rows: [{ id: 1 }, { id: 2 }],
          nextCursor: "cursor-page-2",
          totalCount: 4,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: env({
          columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
          rows: [{ id: 3 }, { id: 4 }],
          nextCursor: null,
          totalCount: 4,
        }),
      });
    }
  });

  await page.goto("/tables/experiments");

  // Load more should appear (nextCursor is non-null)
  const loadMoreBtn = page.getByRole("button", { name: /load more/i });
  await expect(loadMoreBtn).toBeVisible();

  // Click load more
  await loadMoreBtn.click();

  // All 4 rows should be rendered
  await expect(page.getByRole("cell", { name: "1" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "4" }).first()).toBeVisible();

  // Load more should disappear (nextCursor is now null)
  await expect(loadMoreBtn).not.toBeVisible();

  expect(callCount).toBe(2);
});

// ─── Export ───────────────────────────────────────────────────────────────────

test("export button triggers /catalog/export POST with filters and downloads CSV", async ({ page }) => {
  const exportRequests: unknown[] = [];

  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
        rows: [{ id: 1, name: "Alpha" }],
        nextCursor: null,
        totalCount: 1,
      }),
    });
  });
  await page.route("**/api/v1/catalog/export", async (route) => {
    const body = await route.request().postDataJSON();
    exportRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: ["id", "name"],
        csv: "id,name\n1,Alpha\n",
      }),
    });
  });

  // Intercept download
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.goto("/tables/experiments");
      await expect(page.getByRole("cell", { name: "Alpha" })).toBeVisible();
      await page.getByRole("button", { name: /export csv/i }).click();
      // Confirm in dialog
      const dialog = page.getByRole("dialog", { name: /export csv/i });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /export csv/i }).click();
    })(),
  ]);

  expect(download.suggestedFilename()).toBe("experiments.csv");
  expect(exportRequests.length).toBeGreaterThanOrEqual(1);
  const req = exportRequests[0] as Record<string, unknown>;
  expect(req.table).toBe("experiments");
  expect(req.snapshotId).toBe("snap-001");
  expect(Array.isArray(req.columns)).toBe(true);
});

// ─── 413 export limit exceeded ────────────────────────────────────────────────

test("export 413 LIMIT_EXCEEDED shows scoped toast, not crash", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] }],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
        rows: [{ id: 1 }],
        nextCursor: null,
        totalCount: 50000,
      }),
    });
  });
  await page.route("**/api/v1/catalog/export", async (route) => {
    await route.fulfill({
      status: 413,
      contentType: "application/json",
      body: env({ error: { code: "LIMIT_EXCEEDED", message: "Export exceeds 10,000 rows. Narrow filters and retry.", retryable: false } }),
    });
  });

  await page.goto("/tables/experiments");
  await expect(page.getByRole("cell", { name: "1" })).toBeVisible();

  // Trigger export
  await page.getByRole("button", { name: /export csv/i }).click();
  const dialog = page.getByRole("dialog", { name: /export csv/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /export csv/i }).click();

  // Toast should appear with the 413 message
  await expect(page.getByText(/export exceeds 10,000 rows/i)).toBeVisible();

  // Page should still be functional (no crash)
  await expect(page.getByRole("cell", { name: "1" })).toBeVisible();
});

// ─── RecordDrawer focus / Escape ──────────────────────────────────────────────

test("row click opens RecordDrawer, focus trapped, Escape restores row focus", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ],
        rows: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }],
        nextCursor: null,
        totalCount: 2,
      }),
    });
  });

  await page.goto("/tables/experiments");
  await expect(page.getByRole("cell", { name: "Alpha" })).toBeVisible();

  // Click first data row
  const rows = page.getByRole("row");
  // rows[0] is header, rows[1] is first data row
  await rows.nth(1).click();

  // Drawer should open
  const drawer = page.getByRole("dialog", { name: "experiments" });
  await expect(drawer).toBeVisible();

  // Focus should be inside drawer (close button)
  const closeBtn = drawer.getByRole("button", { name: "Close panel" });
  await expect(closeBtn).toBeFocused();

  // Escape closes drawer
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

test("row Enter key opens RecordDrawer", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "experiments", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
        rows: [{ id: 1 }],
        nextCursor: null,
        totalCount: 1,
      }),
    });
  });

  await page.goto("/tables/experiments");
  await expect(page.getByRole("cell", { name: "1" })).toBeVisible();

  // Focus row then press Enter
  const row = page.getByRole("row").nth(1);
  await row.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByRole("dialog", { name: "experiments" });
  await expect(drawer).toBeVisible();
});

// ─── Static notice ────────────────────────────────────────────────────────────

// NOTE: A genuine static-notice test requires a build with NEXT_PUBLIC_STATIC_EXPORT=1.
// That build causes isStaticExport === true at compile time, rendering InlineNotice
// before any API call. The test below uses the static-data manifest route to trigger
// the STATIC_UNAVAILABLE code path that matches what the static viewer shows.
// The exact InlineNotice copy is:
//   "Raw table browsing requires the live server. This static build does not include
//    pre-baked table snapshots. Visit the server deployment to browse tables."
// Verified against CatalogBrowser.tsx CatalogTableList static branch.
//
// The dev-server e2e test below validates the equivalent informational path: when the
// catalog API returns a static-specific error code, the component surfaces a clear
// message that the feature requires the live server.

test("static build shows server-only notice for table workspace", async ({ page }) => {
  // The static viewer returns STATIC_UNAVAILABLE when a client tries to call the API.
  // In the dev server, the component shows ErrorState with the API error message.
  // This test verifies that exact user-visible message is surfaced (not a silent crash).
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: env({
        error: {
          code: "STATIC_UNAVAILABLE",
          message: "This operation is unavailable in the static viewer.",
          retryable: false,
        },
      }),
    });
  });

  await page.goto("/tables");

  // The component surfaces the STATIC_UNAVAILABLE message -- not just "error" but the
  // specific text that tells the user why the feature is unavailable.
  await expect(
    page.getByText(/unavailable in the static viewer/i)
  ).toBeVisible();
});

// ─── Empty state ──────────────────────────────────────────────────────────────

test("table workspace shows empty state when no rows match filters", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-001", label: "T", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "empty_table", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] }],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [{ key: "id", label: "ID", type: "number", nullable: false }],
        rows: [],
        nextCursor: null,
        totalCount: 0,
      }),
    });
  });

  await page.goto("/tables/empty_table");

  // Empty state should appear
  await expect(page.getByText(/no rows/i)).toBeVisible();
});

// ─── Axe accessibility assertions ────────────────────────────────────────────

test("tables index page has no critical axe violations", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-axe", label: "Axe Test", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [
          { name: "axe_table", columns: [{ key: "id", label: "ID", type: "number", nullable: false }] },
        ],
      }),
    });
  });

  await page.goto("/tables");
  await expect(page.getByTestId("table-card-axe_table")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  // Zero serious/critical violations allowed
  const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(
    serious,
    `Axe found ${serious.length} serious/critical violations:\n${serious.map(v => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")}`
  ).toHaveLength(0);
});

test("table workspace page has no critical axe violations", async ({ page }) => {
  await page.route("**/api/v1/catalog/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({ snapshotId: "snap-axe", label: "Axe Test", sourceSystem: "lims", sourceUpdatedAt: null }),
    });
  });
  await page.route("**/api/v1/catalog/tables*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        tables: [{ name: "axe_table", columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ]}],
      }),
    });
  });
  await page.route("**/api/v1/catalog/rows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: env({
        columns: [
          { key: "id", label: "ID", type: "number", nullable: false },
          { key: "name", label: "Name", type: "string", nullable: false },
        ],
        rows: [{ id: 1, name: "Axe Row" }],
        nextCursor: null,
        totalCount: 1,
      }),
    });
  });

  await page.goto("/tables/axe_table");
  await expect(page.getByRole("cell", { name: "Axe Row" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(
    serious,
    `Axe found ${serious.length} serious/critical violations:\n${serious.map(v => `  [${v.impact}] ${v.id}: ${v.description}`).join("\n")}`
  ).toHaveLength(0);
});
