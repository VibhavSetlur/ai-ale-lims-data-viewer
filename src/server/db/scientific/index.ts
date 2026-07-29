import { parseConfig } from "../../config";
import { AppError } from "../../../shared/errors/AppError";
import { SqliteScientificRepository } from "./sqlite";
import type { ScientificRepository } from "./types";

let repository: ScientificRepository | undefined;

export function scientificRepository(): ScientificRepository {
  if (repository) return repository;
  const config = parseConfig(process.env);
  if (config.profile !== "legacy" || !config.legacySqlitePath) {
    throw new AppError("DEPENDENCY_UNAVAILABLE", "Scientific catalog is unavailable.", undefined, { retryable: true });
  }
  repository = new SqliteScientificRepository(config.legacySqlitePath);
  return repository;
}

export function resetScientificRepositoryForTests(): void { repository = undefined; }
export type { ScientificRepository } from "./types";
