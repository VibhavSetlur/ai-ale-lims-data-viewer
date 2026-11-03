// Shared request-size limits for server-side Operations routes.
// Keep these outside route modules because Next.js only permits route-handler
// exports that are part of its public route configuration contract.
export const MAX_DESIGN_BODY_BYTES = 2 * 1024 * 1024;
