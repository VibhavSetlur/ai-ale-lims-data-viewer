import { expect, test } from "@playwright/test";

test("shell exposes correct semantic research landmarks", async ({ page }) => {
  await page.goto("/mutations/cohort");
  // Main content area has the correct ID for skip-link target
  await expect(page.getByRole("main", { name: "" })).toHaveAttribute("id", "main-content");
  // Primary navigation is present
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  // Context rail aside is present
  await expect(page.getByRole("complementary", { name: "Research context" })).toBeVisible();
  // Nav link for cohort is active
  const cohortLink = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Cohort" });
  await expect(cohortLink).toHaveAttribute("aria-current", "page");
});

test("drawer traps keyboard focus, escapes, and restores its opener", async ({ page }) => {
  await page.goto("/tables/samples");
  const opener = page.getByRole("button", { name: /view record/i }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Record details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close record" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Copy" }).last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close record" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("responsive surfaces do not cause page overflow", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/mutations/cohort");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
