#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, [new URL("./stage.mjs", import.meta.url).pathname, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
