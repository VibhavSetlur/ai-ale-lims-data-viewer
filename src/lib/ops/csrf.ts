// Same-origin guard for mutating ops routes. This is a defense-in-depth
// check alongside SameSite=Lax session cookies, not a replacement for them:
// SameSite=Lax already stops the cookie from being attached to most
// cross-site requests (notably cross-site POSTs), but it still allows
// top-level cross-site navigations (plain GET) to carry the cookie, and it
// offers no protection for browsers or proxies that ignore SameSite. Cross
// checking the Origin (or, when absent, Sec-Fetch-Site) header against the
// request's own origin closes that gap for state-changing requests without
// requiring a server-issued CSRF token. Non-browser clients (curl, server-
// to-server calls) send neither header and are allowed through.
import { OpsHttpError } from './guards';

// Under `next start`, Next.js normalizes route-handler `request.url` to the
// bound hostname, so `new URL(req.url).origin` does not reflect the Host the
// client actually sent (e.g. it is always http://localhost:3458 even when a
// browser reaches the app via 127.0.0.1 or an SSH-tunneled hostname). Trusted
// self-identity must instead come from the Host header the client sent.
function expectedHost(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-host');
  const raw = forwarded !== null && forwarded !== '' ? forwarded : req.headers.get('host');
  if (raw === null || raw === '') return null;
  const first = raw.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first.toLowerCase();
}

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  // A literal "null" Origin (sandboxed iframe, some redirects) is present
  // but untrustworthy: reject outright rather than falling through.
  if (origin === 'null') {
    throw new OpsHttpError(403, 'cross_origin', 'Cross-origin write rejected');
  }
  if (origin !== null && origin !== '') {
    const host = expectedHost(req);
    if (host === null) {
      // Client is clearly a browser (it sent Origin) but we have no trusted
      // Host to compare against: reject rather than guess.
      throw new OpsHttpError(403, 'cross_origin', 'Cross-origin write rejected');
    }
    let originHost: string;
    try {
      // Compare host (including port) only, not scheme. Behind an SSH tunnel
      // or a TLS-terminating proxy the scheme the browser sees will not match
      // what this Node process sees, and x-forwarded-proto is not reliably
      // present here, so scheme is deliberately excluded from the check.
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new OpsHttpError(403, 'cross_origin', 'Cross-origin write rejected');
    }
    if (originHost !== host) {
      throw new OpsHttpError(403, 'cross_origin', 'Cross-origin write rejected');
    }
    return;
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite !== null) {
    if (secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      throw new OpsHttpError(403, 'cross_origin', 'Cross-origin write rejected');
    }
    return;
  }

  // Neither header present: allow (non-browser client).
}
