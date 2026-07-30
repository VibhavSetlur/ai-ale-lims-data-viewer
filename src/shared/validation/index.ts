import { AppError } from "../errors/AppError";
import type { ScientificReference } from "../contracts/scientific-reference";

export function requiredText(value: string | undefined, name: string): string {
  const result = value?.trim();
  if (result === undefined || result.length === 0) throw new AppError("INVALID_INPUT", `${name} is required.`);
  return result;
}

export function optionalHttpUrl(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new AppError("INVALID_INPUT", `${name} must be an HTTP or HTTPS URL.`);
  }
}

export function optionalPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^\d+$/.test(value)) throw new AppError("INVALID_INPUT", "APP_PORT must be a valid port.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new AppError("INVALID_INPUT", "APP_PORT must be a valid port.");
  return port;
}

export function scientificReference(value: ScientificReference): ScientificReference {
  return {
    snapshotId: requiredText(value.snapshotId, "snapshotId"),
    entityType: requiredText(value.entityType, "entityType"),
    sourceKey: requiredText(value.sourceKey, "sourceKey"),
  };
}
