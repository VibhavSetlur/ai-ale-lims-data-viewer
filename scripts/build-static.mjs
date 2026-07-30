import { rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const disabled = [
  [new URL("../src/app/api", import.meta.url), new URL("../src/.api-static-disabled", import.meta.url)],
  [new URL("../src/shared/test/api-contract-fixtures.ts", import.meta.url), new URL("../src/shared/test/.api-contract-fixtures-static-disabled.ts", import.meta.url)],
  [new URL("../src/app/plates/[designId]", import.meta.url), new URL("../src/.plate-detail-static-disabled", import.meta.url)],
  [new URL("../src/app/tables/[tableName]", import.meta.url), new URL("../src/.table-detail-static-disabled", import.meta.url)],
];
for (const [source, target] of disabled) await rename(source, target);
try {
  await rm(new URL("../.next", import.meta.url), { recursive: true, force: true });
  const child = spawn("next", ["build"], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, STATIC_EXPORT: "1", NEXT_PUBLIC_STATIC_EXPORT: "1" } });
  await new Promise((resolve, reject) => child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Static build failed with exit code ${code}.`))));
} finally {
  for (const [source, target] of disabled.reverse()) await rename(target, source);
}
