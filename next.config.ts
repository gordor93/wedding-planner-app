import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "pdf-parse",
    "pdf-parse-fork",
    "pdf-text-reader",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],
};

export default nextConfig;
