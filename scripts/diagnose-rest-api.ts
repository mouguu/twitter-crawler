/**
 * Diagnostic Script: Test Twitter API Accessibility
 * 
 * This script tests which Twitter API endpoints are accessible with
 * web cookie authentication (the method used by XRCrawler).
 * 
 * **Expected Results:**
 * - REST API v1.1: ❌ 404 Not Found (requires OAuth)
 * - REST API v2: ❌ 403 Forbidden (requires OAuth)
 * - GraphQL API: ✅ Works (accepts web cookies)
 * 
 * This demonstrates why XRCrawler uses GraphQL API by default.
 */

import { XApiClient } from '../core/x-api';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const cookiesDir = path.join(__dirname, '../cookies');
    const files = fs.readdirSync(cookiesDir).filter(f => f.endsWith('.json'));
    const cookieFile = path.join(cookiesDir, files[1] || files[0]);
    
    console.log(`Using cookie file: ${cookieFile}`);
    let cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
    if (!Array.isArray(cookies) && cookies.cookies) {
        cookies = cookies.cookies;
    }

    const client = new XApiClient(cookies);
    
    // Test different endpoints to see what works
    const testUsername = 'elonmusk';
    
    console.log('\n=== Testing REST API Endpoints ===\n');
    
    // Try the v1.1 endpoint
    const v11Url = `https://api.twitter.com/1.1/statuses/user_timeline.json?screen_name=${testUsername}&count=5`;
    console.log(`1. Testing v1.1 endpoint:  \n   ${v11Url}`);
    
    try {
        const result = await client['requestRest'](v11Url);
        console.log(`   ✅ SUCCESS! Got ${result.length || 0} tweets`);
        if (result[0]) {
            console.log(`   First tweet: ${result[0].text?.substring(0, 50)}...`);
        }
    } catch (error: any) {
        console.log(`   ❌ FAILED: ${error.message}`);
    }
    
    // Try the v2 endpoint
    const v2Url = `https://api.twitter.com/2/users/by/username/${testUsername}`;
    console.log(`\n2. Testing v2 endpoint:\n   ${v2Url}`);
    
    try {
        const result = await client['requestRest'](v2Url);
        console.log(`   ✅ SUCCESS! Got user data`);
        console.log(`   User ID: ${result.data?.id}`);
    } catch (error: any) {
        console.log(`   ❌ FAILED: ${error.message}`);
    }
    
    // Try GraphQL for comparison
    console.log(`\n3. Testing GraphQL (for comparison):`);
    try {
        const userId = await client.getUserByScreenName(testUsername);
        console.log(`   ✅ GraphQL works! User ID: ${userId}`);
        
        const tweets = await client.getUserTweets(userId!, 5);
        console.log(`   ✅ Got tweets via GraphQL`);
    } catch (error: any) {
        console.log(`   ❌ GraphQL FAILED: ${error.message}`);
    }
    
    console.log('\n=== Conclusion ===');
    console.log('Based on the results above:');
    console.log('- If v1.1 works: REST pagination is possible!');
    console.log('- If v2 works: Need to adapt to v2 API');
    console.log('- If both fail: Twitter likely removed REST access for web cookies');
}

main().catch(console.error);
