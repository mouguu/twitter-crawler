import { XApiClient } from '../core/x-api';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const cookiesDir = path.join(__dirname, '../cookies');
    const files = fs.readdirSync(cookiesDir).filter(f => f.endsWith('.json'));
    // Use second account to avoid rate limit from previous tests
    const cookieFile = path.join(cookiesDir, files[1] || files[0]);
    console.log(`Using cookie file: ${cookieFile}`);
    
    let cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
    if (!Array.isArray(cookies) && cookies.cookies) {
        cookies = cookies.cookies;
    }

    const client = new XApiClient(cookies);
    const username = 'DIYgod';

    try {
        console.log(`Fetching user profile for ${username}...`);
        const userId = await client.getUserByScreenName(username);
        console.log(`User ID: ${userId}`);
        
        if (userId) {
            console.log('Fetching user details...');
            // 获取用户详细信息
            const userResponse = await client.getUserTweets(userId, 1); // 只拿1条推文，主要看用户信息
            
            // 尝试从响应中提取用户统计信息
            const userResult = userResponse?.data?.user?.result;
            
            // Try both possible response structures
            const stats = userResult?.legacy || userResult?.core?.user_results?.result?.legacy;
            
            if (stats) {
                console.log('\n📊 User Statistics:');
                console.log(`  Screen Name: @${stats.screen_name || 'DIYgod'}`);
                console.log(`  User ID: ${userId}`);
                console.log(`  Total Tweets (reported): ${stats.statuses_count || 'N/A'}`);
                console.log(`  Followers: ${stats.followers_count || 'N/A'}`);
                console.log(`  Following: ${stats.friends_count || 'N/A'}`);
                console.log(`  Account Created: ${stats.created_at || 'N/A'}`);
                
                if (stats.statuses_count) {
                    console.log('\n💡 Analysis:');
                    console.log(`  📊 Official Tweet Count: ${stats.statuses_count}`);
                    console.log(`  📥 Collected by Scraper: 827`);
                    
                    const difference = Math.abs(stats.statuses_count - 827);
                    const percentage = ((827 / stats.statuses_count) * 100).toFixed(1);
                    
                    console.log(`  📈 Coverage: ${percentage}% (${difference} tweets difference)`);
                    
                    if (difference <= 50) {
                        console.log(`\n  ✅ EXCELLENT: The collected count (827) is very close to the official total (${stats.statuses_count})`);
                        console.log(`     The small difference is normal and may be due to:`);
                        console.log(`     - Protected/private tweets`);
                        console.log(`     - Recently deleted tweets`);
                        console.log(`     - Pinned tweets counted differently`);
                        console.log(`     - API pagination limits`);
                    } else if (stats.statuses_count > 3200) {
                        console.log(`\n  ℹ️  This user has ${stats.statuses_count} tweets, but Twitter API limits access to ~3200`);
                        console.log(`     Collected 827 which suggests the API stopped early (normal behavior)`);
                    } else {
                        console.log(`\n  ⚠️  Collected 827 tweets vs ${stats.statuses_count} reported`);
                        console.log(`     This might indicate:`);
                        console.log(`     - API access restrictions`);
                        console.log(`     - Timeline ended early`);
                        console.log(`     - Some tweets are not accessible`);
                    }
                }
            } else {
                console.log('\n⚠️  Could not extract user statistics from response');
                console.log('Trying to extract from timeline entries...');
                
                // Fallback: check if we got timeline data
                const timelineInstructions = userResponse?.data?.user?.result?.timeline?.timeline?.instructions || 
                                             userResponse?.data?.user?.result?.timeline_v2?.timeline?.instructions;
                                             
                if (timelineInstructions) {
                    console.log(`Found ${timelineInstructions.length} timeline instructions`);
                    console.log('Response indicates user exists and has timeline data');
                } else {
                    console.log('Full response structure:', JSON.stringify(userResponse, null, 2).substring(0, 800));
                }
            }
        }
    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        if (error.code === 'RATE_LIMIT_EXCEEDED') {
            console.error('Rate limit hit. Please wait or try with another account.');
        }
    }

}

main().catch(console.error);
