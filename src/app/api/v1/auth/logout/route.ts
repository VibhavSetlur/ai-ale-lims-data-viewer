import { identityService } from "@/modules/identity/service";
import { loggedJsonSuccess, requestContext } from "@/shared/http/api";
const cookie = (request: Request) => request.headers.get("cookie")?.match(/(?:^|;\s*)viewer2_session=([^;]+)/)?.[1];
export async function POST(request: Request) { const context = requestContext(request.headers); const session = await identityService().logout(cookie(request)); const response = loggedJsonSuccess({ session }, request, context); response.headers.set("Set-Cookie", `viewer2_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "development" ? "" : "; Secure"}`); return response; }
