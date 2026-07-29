import { scientificRepository } from "../../../../../server/db/scientific";
import { post } from "../handlers";
export async function POST(request: Request) { return post(request, (query) => scientificRepository().compareLibraryVariants(query)); }
