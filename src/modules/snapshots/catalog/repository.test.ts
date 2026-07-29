import { describe, expect, it } from "vitest";
import { getCurrentSnapshot, getSnapshot, listSnapshots } from "./repository";
import { AppError } from "../../../shared/errors/AppError";

describe("snapshot catalog repository", () => {
  it("exposes a verified development metadata fixture without its operator path", () => {
    const snapshot = getCurrentSnapshot();
    expect(snapshot).toMatchObject({
      snapshotId: "dev-full-20260726-a86df340",
      status: "metadata-fixture",
      audience: "development",
      materializationStatus: "planned",
      publicationStatus: "planned",
      capabilities: { hasBarcodes: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain("sourcePath");
    expect(JSON.stringify(snapshot)).not.toContain("data/lims_indexed.db");
  });

  it("lists the stable default snapshot", () => {
    expect(listSnapshots().defaultSnapshotId).toBe(getCurrentSnapshot().snapshotId);
  });

  it("rejects an unknown snapshot ID", () => {
    expect(() => getSnapshot("unknown")).toThrow(AppError);
  });
});
