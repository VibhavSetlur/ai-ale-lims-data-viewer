import { identityService } from "@/modules/identity/service";
import { loggedJsonSuccess, requestContext } from "@/shared/http/api";
const cookie = (request: Request) => request.headers.get("cookie")?.match(/(?:^|;\s*)viewer2_session=([^;]+)/)?.[1];
export async function GET(request: Request) { const context = requestContext(request.headers); const service = identityService(); return loggedJsonSuccess({ session: await service.me(cookie(request)), capabilities: service.capabilities() }, request, context); }
