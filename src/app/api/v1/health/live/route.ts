import { live } from "../route-helpers";

export function GET(request: Request) { return live(request); }
