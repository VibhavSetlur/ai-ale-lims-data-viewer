import { loggedJsonError, loggedJsonSuccess, requestContext } from "../../../../../shared/http/api";
import { AppError } from "../../../../../shared/errors/AppError";

/**
 * Server-side proxy to the Argo gateway chat endpoint.
 * Keeps the Argo user id / any credential server-side.
 * Body: { model, messages:[{role,content}], user?, temperature? }
 * Returns: { reply: string, model: string }
 */

const ARGO_URL = "https://apps.inside.anl.gov/argoapi/api/v1/resource/chat/";

const ALLOWED_MODELS = new Set([
  "gpt4o",
  "gpto1",
  "claudeopus4",
  "claudesonnet4",
  "gemini25pro",
]);

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ChatBody = {
  model?: unknown;
  messages?: unknown;
  user?: unknown;
  temperature?: unknown;
};

function validMessages(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (m) =>
      m &&
      typeof m === "object" &&
      typeof (m as ChatMessage).role === "string" &&
      ["system", "user", "assistant"].includes((m as ChatMessage).role) &&
      typeof (m as ChatMessage).content === "string",
  );
}

export async function POST(request: Request) {
  const context = requestContext(request.headers);
  try {
    const body = (await request.json().catch(() => ({}))) as ChatBody;

    const model = typeof body.model === "string" ? body.model : "gpt4o";
    if (!ALLOWED_MODELS.has(model)) {
      throw new AppError("INVALID_INPUT", `Unknown model "${model}".`);
    }
    if (!validMessages(body.messages)) {
      throw new AppError("INVALID_INPUT", "messages must be a non-empty array of {role, content}.");
    }

    // User-supplied Argo user id takes precedence, else server env.
    const suppliedUser = typeof body.user === "string" ? body.user.trim() : "";
    // The server never supplies an Argo identity. Each user must enter their own
    // Argo key in the assistant settings; it is sent per-request and never stored
    // server-side.
    const argoUser = suppliedUser;
    if (!argoUser) {
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        "No Argo key provided. Enter your own Argo key in the assistant settings to use the chat.",
      );
    }

    const temperature =
      typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 2
        ? body.temperature
        : 0.2;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    let upstream: Response;
    try {
      upstream = await fetch(ARGO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: argoUser,
          model,
          messages: body.messages,
          temperature,
        }),
        signal: controller.signal,
      });
    } catch {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "The Argo gateway could not be reached.", undefined, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      throw new AppError(
        "DEPENDENCY_UNAVAILABLE",
        `Argo gateway returned ${upstream.status}. ${text.slice(0, 200)}`.trim(),
        undefined,
        { retryable: upstream.status >= 500 },
      );
    }

    const payload = (await upstream.json().catch(() => ({}))) as { response?: unknown };
    const reply = typeof payload.response === "string" ? payload.response : "";
    if (!reply) {
      throw new AppError("DEPENDENCY_UNAVAILABLE", "Argo gateway returned an empty response.", undefined, { retryable: true });
    }

    return loggedJsonSuccess({ reply, model }, request, context);
  } catch (error) {
    return loggedJsonError(error, request, context);
  }
}
