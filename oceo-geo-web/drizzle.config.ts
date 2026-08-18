import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { resolve } from "path";

// drizzle-kit runs outside Next.js, so it doesn't auto-load .env.local.
config({ path: resolve(__dirname, ".env.local") });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.NEON_DATABASE_URL!,
  },
});
