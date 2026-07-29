import { AppError } from "../../../../shared/errors/AppError";
import { jsonError, jsonSuccess, requestContext } from "../../../../shared/http/api";
import { scientificRepository } from "../../../../server/db/scientific";

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new AppError("INVALID_INPUT", "Request body must be valid JSON."); }
}

export async function handle<T>(request: Request, parse: (value: unknown) => { success: boolean; data?: T }, action: (value: T) => unknown) {
  const context = requestContext(request.headers);
  try {
    const parsed = parse(await readJson(request));
    if (!parsed.success || parsed.data === undefined) throw new AppError("INVALID_INPUT", "Request body is invalid.");
    return jsonSuccess(action(parsed.data), context);
  } catch (error) { return jsonError(error, context); }
}

export function repository() { return scientificRepository(); }
