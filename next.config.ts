import type { NextConfig } from "next";
import { PROXY_BODY_LIMIT_BYTES } from "./src/lib/attachments/constants";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next 16.4 `next dev` writes a managed AGENTS.md into the repo root when it
  // detects an AI coding agent. Agent instructions for this repo live in the
  // checked-in CLAUDE.md, so keep the dev server from adding an untracked file.
  agentRules: false,
  experimental: {
    // Three body-size layers (D-24): Caddy `request_body max_size` and this proxy buffer both
    // equal PROXY_BODY_LIMIT_BYTES (32 MiB); the public upload routes count received bytes and
    // refuse anything above MAX_REQUEST_BODY_BYTES (31 MiB). Next truncates bodies above this
    // value BEFORE the route runs, so it sits one MiB above the route cap: an oversized body
    // still reaches the route and gets a clean 413. tests/unit/body-limit-lockstep.test.ts
    // fails on any drift.
    proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES,
  },
};

export default nextConfig;
