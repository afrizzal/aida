import type { NextConfig } from "next";
import { MAX_TOTAL_REQUEST_BYTES } from "./src/lib/attachments/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16.4 `next dev` writes a managed AGENTS.md into the repo root when it
  // detects an AI coding agent. Agent instructions for this repo live in the
  // checked-in CLAUDE.md, so keep the dev server from adding an untracked file.
  agentRules: false,
  experimental: {
    // Next buffers request bodies at 10MB by default when a proxy/middleware is
    // present, truncating anything larger BEFORE the route runs — which made the
    // intake route's own 413 (file_too_large / payload_too_large) checks
    // unreachable and broke legal multi-file submissions over 10MB combined.
    // Keep this in lockstep with the intake route's combined cap.
    proxyClientMaxBodySize: MAX_TOTAL_REQUEST_BYTES,
  },
};

export default nextConfig;
