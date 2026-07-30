import { rowsQuerySchema } from "../../../../../shared/contracts/catalog";
import { handle, repository } from "../handlers";
export async function POST(request: Request) { return handle(request, (value) => rowsQuerySchema.safeParse(value), (query) => repository().getRows(query)); }
