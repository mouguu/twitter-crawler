/**
 * AI Export Utilities
 * 专门用于生成适合喂给 LLM (ChatGPT/Claude) 进行分析的 Prompt 和数据格式
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 生成人物画像分析的 Prompt 文件
 * @param {Array} tweets - 推文列表
 * @param {Object} profile - 用户资料
 * @param {Object} runContext - 运行上下文
 * @param {string} type - 分析类型 ('persona' | 'feed_analysis')
 */
async function generatePersonaAnalysis(tweets, profile, runContext, type = 'persona') {
  if (!tweets || tweets.length === 0) return;

  const filename = `ai_analysis_prompt_${runContext.identifier}.md`;
  // 使用 runDir 作为输出目录
  const outputDir = runContext.runDir || runContext.outputDir;
  if (!outputDir) {
    console.error('Error: runContext.runDir is undefined');
    return;
  }
  const filePath = path.join(outputDir, filename);

  // 1. 构建系统提示词 (System Prompt)
  let systemPrompt = '';

  if (type === 'feed_analysis') {
    // Home Feed 分析模板
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
    // 默认：人物画像分析模板 (Persona)
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

  // 2. 格式化推文数据 (Data Section)
  // 移除冗余信息，保留时间、文本、互动数、媒体标记
  const formattedTweets = tweets.map((t, index) => {
    const date = t.time ? new Date(t.time).toISOString().split('T')[0] : 'Unknown Date';
    let type = t.isReply ? '[REPLY]' : '[POST]';
    if (t.isLiked) type = '[LIKED]'; // 优先标记为点赞
    
    const metrics = `(❤️${t.likes || 0} 🔁${t.retweets || 0})`;
    const media = t.hasMedia ? '[HAS_MEDIA]' : '';
    
    // 简单的清洗，移除多余换行
    const cleanText = t.text.replace(/\n+/g, ' ').trim();
    
    let line = `${index + 1}. ${date} ${type} ${metrics} ${media}: "${cleanText}"`;
    
    if (t.quotedContent) {
      const cleanQuote = t.quotedContent.replace(/\n+/g, ' ').trim();
      line += `\n    [QUOTING]: "${cleanQuote}"`;
    }
    
    return line;
  }).join('\n');

  const fileContent = `${systemPrompt}\n\n# Raw Data\n\n${formattedTweets}`;

  await fs.writeFile(filePath, fileContent, 'utf-8');
  console.log(`\n🤖 AI Analysis Prompt generated: ${filePath}`);
  console.log(`   (Copy the content of this file to ChatGPT/Claude for instant analysis)`);
  
  return filePath;
}

/**
 * 生成线程分析的 Prompt 文件
 * @param {Array} tweets - 推文列表（包含原推和所有回复）
 * @param {Object} originalTweet - 原推文对象
 * @param {Object} runContext - 运行上下文
 */
async function generateThreadAnalysis(tweets, originalTweet, runContext) {
  if (!tweets || tweets.length === 0) return;

  const filename = `ai_analysis_prompt_${runContext.identifier}.md`;
  const outputDir = runContext.runDir || runContext.outputDir;
  if (!outputDir) {
    console.error('Error: runContext.runDir is undefined');
    return;
  }
  const filePath = path.join(outputDir, filename);

  // 构建系统提示词
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

  // 格式化推文数据
  const formattedTweets = tweets.map((t, index) => {
    const date = t.time ? new Date(t.time).toISOString().split('T')[0] : 'Unknown Date';
    let type = '[REPLY]';
    if (originalTweet && t.id === originalTweet.id) {
      type = '[ORIGINAL]';
    } else if (t.isLiked) {
      type = '[LIKED]';
    }
    
    const metrics = `(❤️${t.likes || 0} 🔁${t.retweets || 0} 💬${t.replies || 0})`;
    const media = t.hasMedia ? '[HAS_MEDIA]' : '';
    const author = t.author ? `@${t.author}` : 'Unknown';
    
    const cleanText = t.text.replace(/\n+/g, ' ').trim();
    
    let line = `${index + 1}. ${date} ${type} ${author} ${metrics} ${media}: "${cleanText}"`;
    
    if (t.quotedContent) {
      const cleanQuote = t.quotedContent.replace(/\n+/g, ' ').trim();
      line += `\n    [QUOTING]: "${cleanQuote}"`;
    }
    
    return line;
  }).join('\n');

  const fileContent = `${systemPrompt}\n\n# Raw Data\n\n${formattedTweets}`;

  await fs.writeFile(filePath, fileContent, 'utf-8');
  console.log(`\n🤖 Thread Analysis Prompt generated: ${filePath}`);
  console.log(`   (Copy the content of this file to ChatGPT/Claude for instant analysis)`);
  
  return filePath;
}

module.exports = {
  generatePersonaAnalysis,
  generateThreadAnalysis // 新增
};

