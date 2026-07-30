import { parseConfig } from "../../config";
import { AppError } from "../../../shared/errors/AppError";
import { MysqlScientificRepository } from "./mysql";
import { SqliteScientificRepository } from "./sqlite";
import type { ScientificRepository } from "./types";

let repository: ScientificRepository | undefined;

export function scientificRepository(): ScientificRepository {
  if (repository) return repository;
  const config = parseConfig(process.env);
  if (config.scientificBackend === "mysql" && config.scientificDatabaseUrl) {
    repository = new MysqlScientificRepository(config.scientificDatabaseUrl);
    return repository;
  }
  if (config.scientificBackend === "sqlite" && config.legacySqlitePath) {
    repository = new SqliteScientificRepository(config.legacySqlitePath);
    return repository;
  }
  throw new AppError("DEPENDENCY_UNAVAILABLE", "Scientific catalog is unavailable.", undefined, { retryable: true });
}

export function resetScientificRepositoryForTests(): void { repository = undefined; }
export type { ScientificRepository } from "./types";
