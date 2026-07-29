import { describe, expect, it } from "vitest";
import { parseConfig, publicConfig } from "./index";

describe("configuration", () => {
  it("defaults to legacy", () => expect(parseConfig({}).profile).toBe("legacy"));
  it("requires distinct plane URLs", () => {
    expect(() => parseConfig({ APP_PROFILE: "planes", SCIENTIFIC_DATABASE_URL: "db", OPERATIONAL_DATABASE_URL: "db" })).toThrow("distinct");
  });
  it("does not publish database URLs", () => {
    const config = parseConfig({ APP_PROFILE: "planes", SCIENTIFIC_DATABASE_URL: "science", OPERATIONAL_DATABASE_URL: "operations" });
    expect(publicConfig(config)).toEqual({ profile: "planes", identityMode: "disabled", appOrigin: undefined, appPort: undefined, orcidRedirectUri: undefined });
  });
});
