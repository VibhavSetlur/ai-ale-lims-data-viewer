import { exportQuerySchema } from "../../../../../shared/contracts/catalog";
import { handle, repository } from "../handlers";
export async function POST(request: Request) { return handle(request, (value) => exportQuerySchema.safeParse(value), (query) => repository().exportRows(query)); }
