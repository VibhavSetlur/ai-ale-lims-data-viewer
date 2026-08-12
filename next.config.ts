import type { NextConfig } from "next";

// Dual-mode config.
//   SERVER build (default):  normal Next.js app with API routes (npm run build).
//   STATIC build:            STATIC_EXPORT=1 -> output a static site under `out/`
//                            for the modelseed.org/annotation/projects/<name> webroot.
//
// The static build is produced by `npm run build:static`, which sets STATIC_EXPORT=1
// and NEXT_PUBLIC_STATIC=1 and temporarily removes the api/ routes (route handlers
// can't be statically exported). basePath/assetPrefix come from NEXT_PUBLIC_BASE_PATH
// so the bundle works when served from a subpath.
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = isStatic
  ? {
      output: "export",
      basePath: basePath || undefined,
      assetPrefix: basePath || undefined,
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {
      // distDir isolates a second server-mode build (e.g. the live ops slice on
      // port 3458, NEXT_DIST_DIR=.next-live) from the default `.next` used by
      // the primary 3457 instance. Unset -> `.next`, byte-identical to before.
      distDir: process.env.NEXT_DIST_DIR || ".next",
    };

export default nextConfig;
