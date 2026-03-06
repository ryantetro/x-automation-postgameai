import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Turbopack (Next 16 default): use next-app as root so lockfile warning is gone
  turbopack: {
    root: configDir,
  },
  webpack: (config) => {
    // Ensure resolution uses next-app when run from monorepo root (webpack fallback)
    config.resolve.modules = [path.join(configDir, "node_modules"), "node_modules"];
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: path.join(configDir, "node_modules/tailwindcss"),
    };
    return config;
  },
};

export default nextConfig;
