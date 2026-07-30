import { cohort } from "../handlers";
export async function GET(request: Request) { return cohort(request); }
