/**
 * API Key Middleware for Hono
 */

import { createMiddleware } from "hono/factory";
import { getConfigManager } from "../utils";

const configManager = getConfigManager();
const serverConfig = configManager.getServerConfig();
const normalizedKey = serverConfig.apiKey?.trim();

console.log(
  "DEBUG: Hono API Key middleware initialized with key:",
  normalizedKey ? "***SET***" : "NOT SET"
);

export const apiKeyMiddleware = createMiddleware(async (c, next) => {
  console.log("DEBUG: Hono API Key middleware called for:", c.req.method, c.req.path);

  // If no API key is configured, allow all traffic (backwards compatible)
  if (!normalizedKey) {
    console.log("DEBUG: No API key configured, allowing request");
    return next();
  }

  // Extract key from header or query param
  const headerKey = c.req.header("x-api-key");
  const queryKey = c.req.query("api_key");
  const provided = headerKey?.trim() || queryKey?.trim();

  console.log("DEBUG: Provided key:", provided ? "***PROVIDED***" : "NOT PROVIDED");

  if (provided && provided === normalizedKey) {
    console.log("DEBUG: API key matches, allowing request");
    return next();
  }

  console.log("DEBUG: API key mismatch or not provided, rejecting");
  return c.json({ error: "Unauthorized" }, 401);
});
