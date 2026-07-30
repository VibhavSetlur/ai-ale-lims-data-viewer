import { describe, expect, it } from "vitest";
import { redact, requestLogEvent, writeLog } from "./index";

describe("observability", () => {
  it("redacts secret values, database credentials, and SQLite paths", () => {
    const value = redact({ authorization: "Bearer secret", databaseUrl: "mysql://user:secret@db/viewer", detail: "/srv/private/lims.sqlite", nested: { token: "token-value" } });
    const text = JSON.stringify(value);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("/srv/private");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("[REDACTED_PATH]");
  });

  it("writes structured request events with correlation IDs", () => {
    const lines: string[] = [];
    const request = new Request("http://localhost/api/v1/status?token=hidden");
    writeLog(requestLogEvent(request, { requestId: "req-1", correlationId: "cor-1" }, 200), (line) => lines.push(line));
    expect(JSON.parse(lines[0]!)).toEqual({ event: "request", level: "info", requestId: "req-1", correlationId: "cor-1", method: "GET", path: "/api/v1/status", status: 200 });
  });
});
