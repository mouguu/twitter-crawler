#!/usr/bin/env python3
"""
Reddit Data Standardizer - Lightweight module for export_to_csv integration

Solves Reddit data complexity challenges:
1. Flattens thread + comment tree structure
2. Normalizes content (removes emojis, links, mentions)
3. Handles deleted/removed content
4. Provides quality scoring for dataset curation
"""

import re
import json
from typing import Dict, List, Any

class RedditStandardizer:
    """Lightweight Reddit data standardization for CSV export"""
    
    def __init__(self):
        # Regex patterns for content cleaning
        self.patterns = {
            'urls': re.compile(r'https?://[^\s]+'),
            'user_mentions': re.compile(r'/?u/[\w-]+'),
            'subreddit_mentions': re.compile(r'/?r/[\w-]+'),
            'markdown_links': re.compile(r'\[([^\]]+)\]\([^\)]+\)'),
            'quotes': re.compile(r'^&gt;.*$', re.MULTILINE),
            'emojis': re.compile(r'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]+'),
            'markdown': re.compile(r'[*_~`#]+'),
            'whitespace': re.compile(r'\s+'),
            'edit_markers': re.compile(r'(EDIT|UPDATE):?\s*', re.IGNORECASE)
        }
    
    def clean_text(self, text: str) -> Dict[str, Any]:
        """
        Clean and standardize text content
        
        Returns:
            Dict with cleaned text and metadata
        """
        if not text or text in ['[deleted]', '[removed]']:
            return {
                'text': '',
                'original': text,
                'is_deleted': text == '[deleted]',
                'is_removed': text == '[removed]',
                'quality_score': 0.0
            }
        
        original = text

        # Fix HTML entities first
        html_entities = {
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#x27;': "'",
            '&#39;': "'",
            '&nbsp;': ' '
        }
        for entity, replacement in html_entities.items():
            text = text.replace(entity, replacement)

        # Replace URLs with placeholder
        text = self.patterns['urls'].sub('[URL]', text)

        # Replace user mentions
        text = self.patterns['user_mentions'].sub('[USER]', text)

        # Replace subreddit mentions
        text = self.patterns['subreddit_mentions'].sub('[SUB]', text)

        # Extract text from markdown links
        text = self.patterns['markdown_links'].sub(r'\1', text)

        # Replace quotes with placeholder
        text = self.patterns['quotes'].sub('[QUOTE]', text)

        # Replace emojis
        text = self.patterns['emojis'].sub('[EMOJI]', text)

        # Remove markdown formatting
        text = self.patterns['markdown'].sub('', text)

        # Remove edit markers
        text = self.patterns['edit_markers'].sub('', text)

        # Final cleanup: remove all placeholders for clean output
        text = re.sub(r'\[URL\]', '', text)
        text = re.sub(r'\[EMOJI\]', '', text)
        text = re.sub(r'\[USER\]', '', text)
        text = re.sub(r'\[SUB\]', '', text)
        text = re.sub(r'\[QUOTE\]', '', text)

        # Final whitespace normalization
        text = self.patterns['whitespace'].sub(' ', text).strip()

        # Calculate quality score
        quality_score = self._calculate_text_quality(text, original)
        
        return {
            'text': text,
            'original': original,
            'is_deleted': False,
            'is_removed': False,
            'quality_score': quality_score
        }
    
    def _calculate_text_quality(self, cleaned: str, original: str) -> float:
        """Calculate text quality score (0-10)"""
        if not cleaned:
            return 0.0
        
        score = 5.0  # Base score
        
        # Length factor
        length = len(cleaned)
        if 50 <= length <= 1000:
            score += 2.0
        elif 20 <= length < 50:
            score += 1.0
        elif length < 10:
            score -= 2.0
        
        # Compression ratio (less cleaning = higher original quality)
        compression = len(cleaned) / max(len(original), 1)
        if compression > 0.8:
            score += 1.0
        elif compression < 0.5:
            score -= 1.0
        
        return min(10.0, max(0.0, score))
    
    def standardize_comments(self, comments: List[Dict]) -> Dict[str, Any]:
        """
        Standardize Reddit comment tree structure
        
        Converts nested comments to flat structure with metadata
        """
        if not comments:
            return {
                'flat_text': '',
                'structured_json': '[]',
                'stats': {
                    'total_comments': 0,
                    'deleted_count': 0,
                    'removed_count': 0,
                    'max_depth': 0,
                    'avg_score': 0.0,
                    'quality_score': 0.0
                }
            }
        
        flat_comments = []
        text_parts = []
        stats = {
            'total_comments': 0,
            'deleted_count': 0,
            'removed_count': 0,
            'max_depth': 0,
            'total_score': 0,
            'quality_scores': []
        }
        
        # 使用迭代代替递归来避免堆栈溢出 (生产级修复)
        comment_stack = [(comment, 0) for comment in reversed(comments)]  # 初始评论入栈

        while comment_stack:
            comment, level = comment_stack.pop()

            if not isinstance(comment, dict):
                continue

            comment_id = comment.get('id', f'c_{len(flat_comments)}')
            author = comment.get('author', '[deleted]')
            body = comment.get('body', '')
            score = comment.get('score', 0)
            created_utc = comment.get('created_utc', 0)

            stats['total_comments'] += 1
            stats['max_depth'] = max(stats['max_depth'], level)
            stats['total_score'] += score

            # Clean comment content
            cleaned = self.clean_text(body)

            if cleaned['is_deleted']:
                stats['deleted_count'] += 1
            elif cleaned['is_removed']:
                stats['removed_count'] += 1
            elif cleaned['text']:
                stats['quality_scores'].append(cleaned['quality_score'])

                # Add to flat structure
                standardized = {
                    'id': comment_id,
                    'author': author,
                    'body': cleaned['text'],
                    'body_original': body,
                    'score': score,
                    'level': level,
                    'created_utc': created_utc,
                    'quality_score': cleaned['quality_score']
                }
                flat_comments.append(standardized)

                # Add to text representation
                indent = "  " * level
                text_part = f"{indent}[{author}] {cleaned['text']} (score:{score})"
                text_parts.append(text_part)

            # 将子评论入栈（逆序以保持原有顺序）
            replies = comment.get('replies', [])
            if replies:
                # 处理Reddit API的嵌套结构
                if isinstance(replies, dict) and 'data' in replies and 'children' in replies['data']:
                    for reply in reversed(replies['data']['children']):
                        if isinstance(reply, dict) and 'data' in reply:
                            comment_stack.append((reply['data'], level + 1))
                elif isinstance(replies, list):
                    for reply in reversed(replies):
                        comment_stack.append((reply, level + 1))
        
        # Calculate final stats
        stats['avg_score'] = stats['total_score'] / max(stats['total_comments'], 1)
        stats['quality_score'] = sum(stats['quality_scores']) / max(len(stats['quality_scores']), 1)
        
        return {
            'flat_text': " | ".join(text_parts),
            'structured_json': json.dumps(flat_comments, ensure_ascii=False),
            'stats': stats
        }
    
    def assess_post_quality(self, post_data: Dict) -> Dict[str, Any]:
        """
        Assess overall post quality for dataset inclusion
        
        Returns quality metrics and inclusion recommendation
        """
        # Clean title and content
        title_clean = self.clean_text(post_data.get('title', ''))
        content_clean = self.clean_text(post_data.get('content', ''))
        
        # Get comment stats
        comment_stats = post_data.get('comment_stats', {})
        
        # Calculate component scores
        title_score = title_clean['quality_score']
        content_score = content_clean['quality_score'] if content_clean['text'] else 5.0  # Links can be valuable
        
        # Engagement score based on Reddit metrics
        score = post_data.get('score', 0)
        comment_count = comment_stats.get('total_comments', 0)
        
        engagement_score = 5.0
        if score > 50:
            engagement_score += 3.0
        elif score > 10:
            engagement_score += 2.0
        elif score > 0:
            engagement_score += 1.0
        elif score < -5:
            engagement_score -= 2.0
        
        if comment_count > 20:
            engagement_score += 2.0
        elif comment_count > 5:
            engagement_score += 1.0
        
        # Overall quality score (weighted average)
        overall_score = (
            title_score * 0.3 +
            content_score * 0.4 +
            engagement_score * 0.3
        )
        
        # Inclusion recommendation
        if overall_score >= 7.0:
            recommendation = 'high_quality'
        elif overall_score >= 5.0:
            recommendation = 'medium_quality'
        elif overall_score >= 3.0:
            recommendation = 'low_quality'
        else:
            recommendation = 'exclude'
        
        return {
            'title_score': title_score,
            'content_score': content_score,
            'engagement_score': engagement_score,
            'overall_score': overall_score,
            'recommendation': recommendation,
            'title_cleaned': title_clean['text'],
            'content_cleaned': content_clean['text']
        }
    
    def create_dataset_ready_row(self, raw_post: Dict) -> Dict[str, Any]:
        """
        Convert raw Reddit post to dataset-ready standardized format
        
        This is the main integration point with export_to_csv
        """
        # Standardize comments
        comment_data = self.standardize_comments(raw_post.get('comments', []))
        
        # Assess quality
        quality_data = self.assess_post_quality({
            'title': raw_post.get('title', ''),
            'content': raw_post.get('selftext', ''),
            'score': raw_post.get('score', 0),
            'comment_stats': comment_data['stats']
        })
        
        # Create standardized row with clean, professional column structure
        # Calculate engagement score: score + (scraped_comments * 2)
        scraped_comment_count = comment_data['stats']['total_comments']
        reddit_comment_count = int(raw_post.get('num_comments', 0))
        post_score = int(raw_post.get('score', 0))
        engagement_score = post_score + (scraped_comment_count * 2)

        return {
            # Core identifiers (following Kaggle dataset standards)
            'post_id': raw_post.get('post_id', ''),
            'title': quality_data['title_cleaned'],
            'content': quality_data['content_cleaned'],
            'author': raw_post.get('author', ''),
            'subreddit': raw_post.get('subreddit', 'UofT'),

            # Timestamps
            'created_utc': int(raw_post.get('created_utc', 0)),
            'created_date': raw_post.get('created_date', ''),

            # Reddit metrics (from Reddit API)
            'score': post_score,
            'upvote_ratio': float(raw_post.get('upvote_ratio', 0)),
            'num_comments': reddit_comment_count,  # Reddit API reported count

            # Comment data (structured JSON for maximum flexibility)
            'comments_json': comment_data['structured_json'],

            # Quality scores (0-10 scale, rounded for readability)
            'quality_title': round(quality_data['title_score'], 1),
            'quality_content': round(quality_data['content_score'], 1),
            'quality_engagement': round(quality_data['engagement_score'], 1),
            'quality_overall': round(quality_data['overall_score'], 1),
            'quality_recommendation': quality_data['recommendation'],

            # Boolean flags for filtering
            'include_in_dataset': quality_data['recommendation'] != 'exclude',

            # Content classification
            'content_type': 'text' if quality_data['content_cleaned'].strip() else 'link',
            'has_discussion': scraped_comment_count >= 3,  # 3+ comments = meaningful discussion

            # Direct URL to post
            'url': f"https://www.reddit.com/r/UofT/comments/{raw_post.get('post_id', '')}/",

            # Calculated engagement metric: score + (num_comments * 2)
            'engagement_score': engagement_score
        }

# Integration function for export_to_csv
def enhance_post_data(post_data: Dict) -> Dict[str, Any]:
    """
    Main integration function - call this from export_to_csv
    
    Args:
        post_data: Raw post data from Supabase
        
    Returns:
        Enhanced post data with standardization
    """
    standardizer = RedditStandardizer()
    return standardizer.create_dataset_ready_row(post_data)

if __name__ == "__main__":
    # Test the standardizer
    standardizer = RedditStandardizer()
    
    # Test text cleaning
    sample_text = "Check out https://example.com and u/user mentioned r/UofT! 🎉 **bold text**"
    result = standardizer.clean_text(sample_text)
    
    print("Text Cleaning Test:")
    print(f"Original: {sample_text}")
    print(f"Cleaned: {result['text']}")
    print(f"Quality Score: {result['quality_score']}")
