import { expect, test } from "@playwright/test";

test("assistant requires confirmation and exposes semantic research landmarks", async ({ page }) => {
  await page.goto("/mutations/cohort");
  await expect(page.getByRole("main", { name: "" })).toHaveAttribute("id", "research-canvas");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research navigation demo" })).toBeVisible();
  await page.getByLabel("What would you like to explore?").fill("tables");
  await page.getByRole("button", { name: "Suggest" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByText("Proposed destination")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Proposed destination")).toBeHidden();
  await page.getByRole("button", { name: "Suggest" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/tables/);
});

test("drawer traps keyboard focus, escapes, and restores its opener", async ({ page }) => {
  await page.goto("/tables");
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
