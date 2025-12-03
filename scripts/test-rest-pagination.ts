/**
 * Test REST API v1.1 Pagination
 * 
 * ⚠️ **EXPECTED RESULT: 404 Not Found**
 * 
 * This test demonstrates that Twitter's REST API v1.1 does NOT work
 * with web cookie authentication. It requires OAuth 1.0a tokens from
 * a Twitter Developer Account.
 * 
 * This script is kept for:
 * - Documentation of why REST API doesn't work
 * - Testing if Twitter changes their API policy
 * - Reference for max_id pagination logic
 * 
 * For working pagination, see: scripts/test-graphql-pagination.ts
 */

import { ScraperEngine } from "../core/scraper-engine";
import { runTimelineApi } from "../core/timeline-api-runner";
import * as fs from "fs";
import * as path from "path";

async function main() {
  // 1. Load cookies
  const cookiesDir = path.join(__dirname, "../cookies");
  if (!fs.existsSync(cookiesDir)) {
    console.error("Cookies directory not found");
    return;
  }

  const files = fs.readdirSync(cookiesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No cookie files found in cookies/");
    return;
  }

  const cookieFile = path.join(cookiesDir, files[0]);
  console.log(`Using cookie file: ${cookieFile}`);

  // 2. Initialize Engine
  const engine = new ScraperEngine(undefined, {
    apiOnly: true, // We only need API for this test
    sessionId: path.basename(cookieFile), // Hint to use this session
  });

  await engine.init();
  const success = await engine.loadCookies(false); // Disable rotation for simple test
  if (!success) {
    console.error("Failed to load cookies");
    return;
  }

  // 3. Run REST Timeline Test
  console.log("Starting REST Timeline Pagination Test...");
  const result = await runTimelineApi(engine, {
    username: "elonmusk", // High volume user good for pagination testing
    limit: 300, // Request > 200 to force at least one pagination
    mode: "timeline",
    scrapeMode: "graphql", // This config field is a bit confusing, but apiVariant controls the runner
    apiVariant: "rest", // FORCE REST API runner
    outputDir: path.join(__dirname, "../output/test-rest"),
  });

  // 4. Analyze Results
  console.log("---------------------------------------------------");
  console.log(`Test Finished. Success: ${result.success}`);
  console.log(`Total Tweets Collected: ${result.tweets.length}`);

  if (result.tweets.length > 0) {
    const first = result.tweets[0];
    const last = result.tweets[result.tweets.length - 1];
    console.log(`First Tweet ID: ${first.id} (${first.time})`);
    console.log(`Last Tweet ID:  ${last.id} (${last.time})`);

    // Verify IDs are decreasing
    let previousId = BigInt(first.id);
    let orderCorrect = true;
    for (let i = 1; i < result.tweets.length; i++) {
      const currentId = BigInt(result.tweets[i].id);
      if (currentId >= previousId) {
        console.error(
          `[ERROR] Order violation at index ${i}: ${currentId} >= ${previousId}`
        );
        orderCorrect = false;
      }
      previousId = currentId;
    }

    if (orderCorrect) {
      console.log("✅ Tweet IDs are strictly decreasing (Pagination working)");
    } else {
      console.log("❌ Tweet IDs are NOT strictly decreasing");
    }
  }

  if (result.error) {
    console.error(`Error: ${result.error}`);
  }
}

main().catch(console.error);
