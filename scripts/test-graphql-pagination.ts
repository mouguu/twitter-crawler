import { ScraperEngine } from '../core/scraper-engine';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    // 1. Load cookies
    const cookiesDir = path.join(__dirname, '../cookies');
    if (!fs.existsSync(cookiesDir)) {
        console.error('Cookies directory not found');
        return;
    }

    const files = fs.readdirSync(cookiesDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.error('No cookie files found in cookies/');
        return;
    }

    const cookieFile = path.join(cookiesDir, files[0]);
    console.log(`Using cookie file: ${cookieFile}`);
    
    // 2. Initialize Engine
    const engine = new ScraperEngine(undefined, {
        apiOnly: true,
        sessionId: path.basename(cookieFile)
    });

    await engine.init();
    const success = await engine.loadCookies(false);
    if (!success) {
        console.error('Failed to load cookies');
        return;
    }

    // 3. Run GraphQL Timeline Test
    console.log('Starting GraphQL Timeline Pagination Test...');
    console.log('Testing with limit=300 to trigger pagination...\n');
    
    const result = await engine.scrapeTimeline({
        username: 'elonmusk',
        limit: 300,
        mode: 'timeline',
        scrapeMode: 'graphql', // Use GraphQL (cursor-based pagination)
        saveMarkdown: false,
        exportCsv: false,
        exportJson: false,
        outputDir: path.join(__dirname, '../output/test-graphql')
    });

    // 4. Analyze Results
    console.log('\n---------------------------------------------------');
    console.log(`Test Finished. Success: ${result.success}`);
    console.log(`Total Tweets Collected: ${result.tweets.length}`);
    
    if (result.tweets.length > 0) {
        const first = result.tweets[0];
        const last = result.tweets[result.tweets.length - 1];
        console.log(`\nFirst Tweet ID: ${first.id}`);
        console.log(`  - Time: ${first.time}`);
        console.log(`  - Text: ${first.text?.substring(0, 50)}...`);
        console.log(`\nLast Tweet ID:  ${last.id}`);
        console.log(`  - Time: ${last.time}`);
        console.log(`  - Text: ${last.text?.substring(0, 50)}...`);
        
        // Verify IDs are decreasing (older tweets have smaller IDs)
        console.log('\nVerifying chronological order...');
        let previousId = BigInt(first.id);
        let orderCorrect = true;
        let violations = 0;
        
        for (let i = 1; i < result.tweets.length; i++) {
            const currentId = BigInt(result.tweets[i].id);
            if (currentId >= previousId) {
                if (violations < 5) {
                    console.error(`  [ERROR] Order violation at index ${i}: ${currentId} >= ${previousId}`);
                }
                orderCorrect = false;
                violations++;
            }
            previousId = currentId;
        }
        
        if (orderCorrect) {
            console.log('✅ Tweet IDs are strictly decreasing (Pagination working correctly)');
            console.log('   GraphQL cursor-based pagination follows same max_id principle');
        } else {
            console.log(`❌ Found ${violations} order violations`);
        }
        
        // Check if we hit the limit or reached end
        if (result.tweets.length >= 300) {
            console.log('\n✅ Successfully fetched 300+ tweets via pagination');
        } else {
            console.log(`\n⚠️  Only fetched ${result.tweets.length} tweets (may be timeline end or API limit)`);
        }
    }

    if (result.error) {
        console.error(`\nError: ${result.error}`);
    }
}

main().catch(console.error);
