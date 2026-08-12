// Public status probe: no auth, no DB access. This is the single source the
// UI uses to decide between "sign in" and "setup required". Must never leak
// a configuration value, only whether each piece is present.
import { opsStatus } from '@/lib/ops/config';
import { opsOk } from '@/lib/ops/api';

export async function GET() {
  return opsOk(opsStatus());
}
