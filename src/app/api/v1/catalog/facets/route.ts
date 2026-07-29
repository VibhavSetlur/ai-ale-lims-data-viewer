import { facetsQuerySchema } from "../../../../../shared/contracts/catalog";
import { handle, repository } from "../handlers";
export async function POST(request: Request) { return handle(request, (value) => facetsQuerySchema.safeParse(value), (query) => repository().getFacets(query)); }
