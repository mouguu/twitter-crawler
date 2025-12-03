/**
 * Reddit to Markdown Exporter
 * Converts Reddit posts and comments to readable Markdown format
 */

import * as fs from 'fs';
import * as path from 'path';
import { RedditPost, FlattenedComment } from './types';

/**
 * Format a Reddit post with comments as Markdown
 */
export function formatPostAsMarkdown(
  post: RedditPost,
  comments: FlattenedComment[]
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${post.title}`);
  lines.push('');
  lines.push(`**Author**: u/${post.author} | **Subreddit**: r/${post.subreddit}`);
  lines.push(`**Score**: ${post.score} (${Math.round(post.upvote_ratio * 100)}% upvoted) | **Comments**: ${post.num_comments}`);
  lines.push(`**Posted**: ${new Date(post.created_utc * 1000).toISOString()}`);
  lines.push(`**URL**: ${post.permalink}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Post content
  if (post.selftext) {
    lines.push('## Post Content');
    lines.push('');
    lines.push(post.selftext);
    lines.push('');
    lines.push('---');
    lines.push('');
  } else if (post.url && !post.is_self) {
    lines.push('## Link');
    lines.push('');
    lines.push(`[${post.url}](${post.url})`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Comments
  if (comments.length > 0) {
    lines.push(`## Comments (${comments.length})`);
    lines.push('');

    for (const comment of comments) {
      const indent = '  '.repeat(comment.depth);
      const submitterBadge = comment.is_submitter ? ' `[OP]`' : '';
      const gildedBadge = comment.gilded > 0 ? ` 🏆×${comment.gilded}` : '';
      
      lines.push(`${indent}**u/${comment.author}**${submitterBadge} • ${comment.score} points${gildedBadge}`);
      lines.push('');
      
      // Format comment body with proper indentation
      const bodyLines = comment.body.split('\n');
      for (const bodyLine of bodyLines) {
        lines.push(`${indent}${bodyLine}`);
      }
      
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Export Reddit post(s) to Markdown file
 */
export function exportRedditToMarkdown(
  posts: Array<{ post: RedditPost; comments: FlattenedComment[] }>,
  outputDir: string,
  filename?: string
): string {
  fs.mkdirSync(outputDir, { recursive: true });

  let markdownPath: string;

  if (posts.length === 1) {
    // Single post - use custom filename or post title
    const post = posts[0];
    const sanitizedTitle = sanitizeFilename(post.post.title);
    const basename = filename || `${sanitizedTitle}.md`;
    markdownPath = path.join(outputDir, basename);
    
    const content = formatPostAsMarkdown(post.post, post.comments);
    fs.writeFileSync(markdownPath, content, 'utf-8');
  } else {
    // Multiple posts - create index
    markdownPath = path.join(outputDir, filename || 'index.md');
    const lines: string[] = [];

    lines.push(`# Reddit Posts Export`);
    lines.push('');
    lines.push(`**Total Posts**: ${posts.length}`);
    lines.push(`**Exported**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (let i = 0; i < posts.length; i++) {
      const { post, comments } = posts[i];
      
      lines.push(`## ${i + 1}. ${post.title}`);
      lines.push('');
      lines.push(`**Author**: u/${post.author} | **r/${post.subreddit}**`);
      lines.push(`**Score**: ${post.score} | **Comments**: ${post.num_comments}`);
      lines.push(`**Link**: ${post.permalink}`);
      lines.push('');
      
      if (post.selftext) {
        const preview = post.selftext.slice(0, 200);
        lines.push(`> ${preview}${post.selftext.length > 200 ? '...' : ''}`);
        lines.push('');
      }
      
      lines.push('---');
      lines.push('');
    }

    fs.writeFileSync(markdownPath, lines.join('\n'), 'utf-8');

    // Also save individual posts
    for (let i = 0; i < posts.length; i++) {
      const { post, comments } = posts[i];
      const sanitizedTitle = sanitizeFilename(post.title);
      const postPath = path.join(outputDir, `${String(i + 1).padStart(3, '0')}-${sanitizedTitle}.md`);
      const content = formatPostAsMarkdown(post, comments);
      fs.writeFileSync(postPath, content, 'utf-8');
    }
  }

  return markdownPath;
}

/**
 * Sanitize filename (remove special characters)
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 100); // Limit length
}
