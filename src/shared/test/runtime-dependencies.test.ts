import { chromium } from "@playwright/test";
import mysql from "mysql2/promise";
import { Umzug } from "umzug";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("WP1 runtime dependencies", () => {
  it("loads the selected validation, MySQL, migration, and E2E APIs", () => {
    expect(z.string().parse("contract")).toBe("contract");
    expect(typeof mysql.createPool).toBe("function");
    expect(typeof Umzug).toBe("function");
    expect(typeof chromium.executablePath()).toBe("string");
  });
});
