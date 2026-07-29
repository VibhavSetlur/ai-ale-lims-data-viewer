import { AppError } from "../../shared/errors/AppError";
import { optionalHttpUrl, optionalPort, requiredText } from "../../shared/validation";

export type AppProfile = "legacy" | "planes";

export interface AppConfig {
  profile: AppProfile;
  appOrigin?: string;
  appPort?: number;
  orcidRedirectUri?: string;
  scientificDatabaseUrl?: string;
  operationalDatabaseUrl?: string;
}

export interface PublicConfig {
  profile: AppProfile;
  appOrigin?: string;
  appPort?: number;
  orcidRedirectUri?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function parseConfig(env: Environment): AppConfig {
  const profileValue = env.APP_PROFILE?.trim() || "legacy";
  if (profileValue !== "legacy" && profileValue !== "planes") throw new AppError("INVALID_CONFIG", "APP_PROFILE must be legacy or planes.");
  const config: AppConfig = {
    profile: profileValue,
    appOrigin: optionalHttpUrl(env.APP_ORIGIN, "APP_ORIGIN"),
    appPort: optionalPort(env.APP_PORT),
    orcidRedirectUri: optionalHttpUrl(env.ORCID_REDIRECT_URI, "ORCID_REDIRECT_URI"),
  };
  if (profileValue === "planes") {
    const scientificDatabaseUrl = requiredText(env.SCIENTIFIC_DATABASE_URL, "SCIENTIFIC_DATABASE_URL");
    const operationalDatabaseUrl = requiredText(env.OPERATIONAL_DATABASE_URL, "OPERATIONAL_DATABASE_URL");
    if (scientificDatabaseUrl === operationalDatabaseUrl) throw new AppError("INVALID_CONFIG", "Database URLs must be distinct.");
    return { ...config, scientificDatabaseUrl, operationalDatabaseUrl };
  }
  return config;
}

export function publicConfig(config: AppConfig): PublicConfig {
  const { profile, appOrigin, appPort, orcidRedirectUri } = config;
  return { profile, appOrigin, appPort, orcidRedirectUri };
}
