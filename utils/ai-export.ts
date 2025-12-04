import { promises as fs } from 'fs';
import * as path from 'path';
import { RunContext } from './fileutils';
import type { Tweet, ProfileInfo } from '../types/tweet-definitions';

type AnalysisType = 'persona' | 'feed_analysis';

const buildSafeOutputPath = (runContext: RunContext | undefined, filename: string): string | null => {
  const outputDir = runContext?.runDir;
  if (!outputDir) {
    console.error('Error: runContext.runDir is undefined');
    return null;
  }
  return path.join(outputDir, filename);
};

export async function generatePersonaAnalysis(
  tweets: Tweet[],
  profile: ProfileInfo | null | undefined,
  runContext: RunContext,
  type: AnalysisType = 'persona'
): Promise<string | void> {
  if (!tweets || tweets.length === 0) return;

  const filePath = buildSafeOutputPath(runContext, `ai_analysis_prompt_${runContext.identifier}.md`);
  if (!filePath) return;

  let systemPrompt = '';

  if (type === 'feed_analysis') {
    systemPrompt = `
# Role
You are an expert social media algorithm analyst and content strategist.

# Task
Analyze the following "Home Timeline" feed content to understand what the Twitter/X algorithm is recommending to this user.
Based on the content, reverse-engineer the user's potential interests and the algorithm's perception of them.

# Output Format
Please provide the analysis in the following structure:
1. **Content Categories**: What are the dominant topics? (e.g., Tech, Politics, Anime, Crypto)
2. **Emotional Vibe**: Is the feed mostly angry, informative, shitposting, or wholesome?
3. **User Interest Profile**: Based on this feed, what does the algorithm think the user is interested in?
4. **Echo Chamber Analysis**: Is the content diverse, or is it reinforcing a specific worldview?
5. **Notable Trends**: Any viral memes or breaking news dominating this specific timeline?

# Data Context
- Total Tweets Analyzed: ${tweets.length}
- Source: Home Timeline (For You / Following)
`;
  } else {
    systemPrompt = `
# Role
You are an expert psychologist and social media analyst specializing in "Digital Persona Profiling".

# Task
Analyze the following Twitter/X data for user "@${profile?.handle || runContext.identifier}". 
Construct a comprehensive psychological and behavioral profile.

# Output Format
Please provide the analysis in the following structure:
1. **Core Personality**: Big Five traits, values, and emotional baseline.
2. **Communication Style**: Tone (sarcastic, academic, casual), vocabulary, and sentence structure.
3. **Interests & Obsessions**: Key topics they post about frequently.
4. **Social Graph**: How they interact with others (supportive, confrontational, cliquey).
5. **Speculative Background**: Likely profession, age group, or location based on context clues.

# Data Context
- Total Tweets Analyzed: ${tweets.length}
- User Bio: "${profile?.bio || 'N/A'}"
- User Stats: ${profile?.followers || 0} followers, ${profile?.following || 0} following.
`;
  }

  const formattedTweets = tweets.map((tweet, index) => {
    const date = tweet.time ? new Date(tweet.time).toISOString().split('T')[0] : 'Unknown Date';
    let typeLabel = tweet.isReply ? '[REPLY]' : '[POST]';
    if ((tweet as any).isLiked) typeLabel = '[LIKED]';

    const metrics = `(❤️${tweet.likes || 0} 🔁${tweet.retweets || 0})`;
    const media = tweet.hasMedia ? '[HAS_MEDIA]' : '';

    const cleanText = (tweet.text || '').toString().replace(/\n+/g, ' ').trim();
    let line = `${index + 1}. ${date} ${typeLabel} ${metrics} ${media}: "${cleanText}"`;

    if ((tweet as any).quotedContent) {
      const cleanQuote = (tweet as any).quotedContent.replace(/\n+/g, ' ').trim();
      line += `\n    [QUOTING]: "${cleanQuote}"`;
    }

    return line;
  }).join('\n');

  const fileContent = `${systemPrompt}\n\n# Raw Data\n\n${formattedTweets}`;

  await fs.writeFile(filePath, fileContent, 'utf-8');
  console.log(`\n🤖 AI Analysis Prompt generated: ${filePath}`);
  console.log('   (Copy the content of this file to ChatGPT/Claude for instant analysis)');

  return filePath;
}

export async function generateThreadAnalysis(tweets: Tweet[], originalTweet: Tweet | undefined, runContext: RunContext): Promise<string | void> {
  if (!tweets || tweets.length === 0) return;

  const filePath = buildSafeOutputPath(runContext, `ai_analysis_prompt_${runContext.identifier}.md`);
  if (!filePath) return;

  const systemPrompt = `
# Role
You are an expert social media conversation analyst and discourse researcher.

# Task
Analyze the following Twitter/X thread (a tweet and its replies) to understand:
1. The main topic and arguments presented
2. The diversity of opinions and perspectives
3. The tone and quality of discourse
4. Key themes and sub-discussions
5. Notable patterns in how people respond

# Output Format
Please provide the analysis in the following structure:
1. **Main Topic**: What is the original tweet about?
2. **Argument Structure**: What are the main arguments presented in the thread?
3. **Opinion Spectrum**: How diverse are the responses? (Supportive, critical, neutral, etc.)
4. **Discourse Quality**: Is the conversation constructive, toxic, informative, or chaotic?
5. **Key Themes**: What recurring topics or concerns appear in the replies?
6. **Notable Patterns**: Any interesting behavioral patterns (e.g., echo chambers, brigading, thoughtful discussion)?

# Data Context
- Original Tweet: ${originalTweet ? 'Included' : 'Not found'}
- Total Replies Analyzed: ${tweets.length - (originalTweet ? 1 : 0)}
- Total Items in Thread: ${tweets.length}
`;

  const formattedTweets = tweets.map((tweet, index) => {
    const date = tweet.time ? new Date(tweet.time).toISOString().split('T')[0] : 'Unknown Date';
    let typeLabel = '[REPLY]';
    if (originalTweet && tweet.id === originalTweet.id) {
      typeLabel = '[ORIGINAL]';
    } else if ((tweet as any).isLiked) {
      typeLabel = '[LIKED]';
    }

    const metrics = `(❤️${tweet.likes || 0} 🔁${tweet.retweets || 0} 💬${tweet.replies || 0})`;
    const media = tweet.hasMedia ? '[HAS_MEDIA]' : '';
    const author = (tweet as any).author ? `@${(tweet as any).author}` : 'Unknown';

    const cleanText = (tweet.text || '').toString().replace(/\n+/g, ' ').trim();

    let line = `${index + 1}. ${date} ${typeLabel} ${author} ${metrics} ${media}: "${cleanText}"`;

    if ((tweet as any).quotedContent) {
      const cleanQuote = (tweet as any).quotedContent.replace(/\n+/g, ' ').trim();
      line += `\n    [QUOTING]: "${cleanQuote}"`;
    }

    return line;
  }).join('\n');

  const fileContent = `${systemPrompt}\n\n# Raw Data\n\n${formattedTweets}`;

  await fs.writeFile(filePath, fileContent, 'utf-8');
  console.log(`\n🤖 Thread Analysis Prompt generated: ${filePath}`);
  console.log('   (Copy the content of this file to ChatGPT/Claude for instant analysis)');

  return filePath;
}
