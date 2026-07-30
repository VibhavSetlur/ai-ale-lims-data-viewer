import { AppError } from "@/shared/errors/AppError";
import type { Identity, IdentityProvider } from "./contracts";
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export class FakeProvider implements IdentityProvider { async authenticate(input: unknown): Promise<Identity> { const value = input as Record<string, unknown>; if (!value || typeof value.orcid !== "string" || !ORCID.test(value.orcid) || typeof value.displayName !== "string" || value.displayName.trim().length < 1 || value.displayName.trim().length > 120) throw new AppError("INVALID_INPUT", "A valid ORCID-shaped identifier and display name are required."); return { provider: "orcid", subject: value.orcid, displayName: value.displayName.trim() }; } }
