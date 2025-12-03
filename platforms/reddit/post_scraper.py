#!/usr/bin/env python3
"""
Reddit Single Post Scraper
Scrapes a single Reddit post with all nested comments using the JSON API
"""

import requests
import re
import json
import time
from typing import Dict, List, Any, Optional, Tuple, Callable
from datetime import datetime


class RedditPostScraper:
    """Scraper for single Reddit posts using the JSON API"""
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        self.rate_limit_delay = 2.0  # seconds between requests
        
    def parse_reddit_url(self, url: str) -> Dict[str, str]:
        """
        Parse Reddit URL to extract subreddit and post ID
        
        Supports formats:
        - https://www.reddit.com/r/Bard/comments/1p84jda/title/
        - https://old.reddit.com/r/UofT/comments/abc123/
        - https://redd.it/1p84jda
        
        Returns:
            dict: {'subreddit': str, 'post_id': str, 'canonical_url': str}
        """
        url = url.strip()
        
        # Pattern 1: Standard Reddit URL
        # https://www.reddit.com/r/subreddit/comments/post_id/...
        pattern1 = r'reddit\.com/r/(\w+)/comments/([a-z0-9]+)'
        match = re.search(pattern1, url, re.IGNORECASE)
        if match:
            subreddit = match.group(1)
            post_id = match.group(2)
            canonical_url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}"
            return {
                'subreddit': subreddit,
                'post_id': post_id,
                'canonical_url': canonical_url
            }
        
        # Pattern 2: Short link (redd.it)
        # https://redd.it/1p84jda
        pattern2 = r'redd\.it/([a-z0-9]+)'
        match = re.search(pattern2, url, re.IGNORECASE)
        if match:
            post_id = match.group(1)
            # For short links, we need to fetch to get the subreddit
            # We'll return a partial result and handle it in scrape_post
            return {
                'subreddit': None,  # Will be resolved later
                'post_id': post_id,
                'canonical_url': f"https://redd.it/{post_id}"
            }
        
        raise ValueError(f"Invalid Reddit URL format: {url}")
    
    def fetch_json(self, url: str, max_retries: int = 0) -> Dict:
        """
        Fetch JSON data from Reddit API
        
        Args:
            url: Reddit URL (will append .json automatically)
            max_retries: Maximum number of retries (0 = no retry, fail fast)
            
        Returns:
            dict: Parsed JSON response
        """
        # Ensure URL ends with .json
        if not url.endswith('.json'):
            url = url.rstrip('/') + '.json'
        
        print(f"🌐 Fetching: {url}")
        
        for attempt in range(max_retries + 1):
            try:
                time.sleep(self.rate_limit_delay)  # Rate limiting
                # Short timeouts: connect 5s, read 20s - fail fast
                response = self.session.get(url, timeout=(5, 20))
                response.raise_for_status()
                return response.json()
            except requests.exceptions.Timeout as e:
                # Timeout = skip immediately, no retry
                raise Exception(f"Request timeout: {url}")
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    # Rate limit = skip immediately, don't wait
                    raise Exception(f"Rate limited: {url}")
                raise
            except requests.exceptions.RequestException as e:
                # Network error = skip immediately, no retry
                raise Exception(f"Network error: {str(e)}")
            except Exception as e:
                raise Exception(f"Failed to fetch JSON from {url}: {str(e)}")
        
        raise Exception(f"Failed to fetch JSON from {url}")
    
    def parse_comment_tree(self, comment_data: Dict, depth: int = 0, parent_id: Optional[str] = None) -> List[Dict]:
        """
        Recursively parse comment tree into a flat list
        
        Args:
            comment_data: Comment data from Reddit JSON
            depth: Current nesting depth
            parent_id: ID of parent comment
            
        Returns:
            list: Flattened list of comments with metadata
        """
        comments = []
        
        if not comment_data or comment_data.get('kind') != 'Listing':
            return comments
        
        children = comment_data.get('data', {}).get('children', [])
        
        for child in children:
            kind = child.get('kind')
            data = child.get('data', {})
            
            if kind == 't1':  # Comment
                comment_id = data.get('id')
                
                comment = {
                    'id': comment_id,
                    'author': data.get('author'),
                    'body': data.get('body', ''),
                    'score': data.get('score', 0),
                    'created_utc': data.get('created_utc'),
                    'depth': depth,
                    'parent_id': parent_id,
                    'permalink': f"https://reddit.com{data.get('permalink', '')}",
                    'is_submitter': data.get('is_submitter', False),
                    'gilded': data.get('gilded', 0),
                    'controversiality': data.get('controversiality', 0),
                }
                
                comments.append(comment)
                
                # Recursively parse replies
                replies = data.get('replies')
                if replies and isinstance(replies, dict):
                    child_comments = self.parse_comment_tree(replies, depth + 1, comment_id)
                    comments.extend(child_comments)
            
            elif kind == 'more':
                # "Load more comments" - these are continuation tokens
                # For now, we'll note how many are hidden
                count = data.get('count', 0)
                if count > 0:
                    print(f"  ⚠️ {count} more comments hidden at depth {depth} (requires additional API call)")
        
        return comments
    
    def scrape_post(self, post_url: str, log_callback: Optional[Callable] = None) -> Dict[str, Any]:
        """
        Scrape a single Reddit post with all nested comments
        
        Args:
            post_url: Reddit post URL
            log_callback: Optional callback for logging
            
        Returns:
            dict: Result dictionary
        """
        def log(msg):
            if log_callback:
                log_callback(msg)
            print(msg)

        try:
            # Step 1: Parse URL
            # log(f"🔍 Parsing URL...")
            url_info = self.parse_reddit_url(post_url)
            post_id = url_info['post_id']
            subreddit = url_info['subreddit']
            
            # Step 2: Fetch JSON data
            log(f"📥 Fetching post data for ID: {post_id}")
            
            # Use canonical URL for fetching
            if subreddit:
                fetch_url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}"
            else:
                # For short links, use the short URL and extract subreddit from response
                fetch_url = url_info['canonical_url']
            
            json_data = self.fetch_json(fetch_url)
            
            # Step 3: Parse post data (first listing)
            if not json_data or len(json_data) < 1:
                return {'status': 'error', 'message': 'Invalid JSON response'}
            
            post_listing = json_data[0]
            post_children = post_listing.get('data', {}).get('children', [])
            
            if not post_children:
                return {'status': 'error', 'message': 'No post data found'}
            
            post_data = post_children[0].get('data', {})
            
            # Extract subreddit if we didn't have it
            if not subreddit:
                subreddit = post_data.get('subreddit')
            
            post = {
                'id': post_data.get('id'),
                'title': post_data.get('title'),
                'selftext': post_data.get('selftext', ''),
                'author': post_data.get('author'),
                'subreddit': subreddit,
                'score': post_data.get('score', 0),
                'upvote_ratio': post_data.get('upvote_ratio', 0),
                'num_comments': post_data.get('num_comments', 0),
                'created_utc': post_data.get('created_utc'),
                'url': post_data.get('url'),
                'permalink': f"https://reddit.com{post_data.get('permalink', '')}",
                'is_self': post_data.get('is_self', False),
                'link_flair_text': post_data.get('link_flair_text'),
                'gilded': post_data.get('gilded', 0),
                'over_18': post_data.get('over_18', False),
            }
            
            log(f"✅ Post: '{post['title'][:60]}...' by u/{post['author']}")
            # log(f"📊 Stats: {post['score']} points, {post['num_comments']} comments")
            
            # Step 4: Parse comments (second listing)
            comments = []
            if len(json_data) >= 2:
                # log(f"🔄 Parsing comment tree...")
                comment_listing = json_data[1]
                comments = self.parse_comment_tree(comment_listing, depth=0, parent_id=post['id'])
                # log(f"✅ Parsed {len(comments)} comments")
            
            return {
                'status': 'success',
                'post': post,
                'comments': comments,
                'comment_count': len(comments),
                'expected_comment_count': post['num_comments'],
                'raw_json': json_data  # Include for debugging
            }
            
        except ValueError as e:
            return {'status': 'error', 'message': str(e)}
        except Exception as e:
            return {'status': 'error', 'message': f'Scraping failed: {str(e)}'}


def main():
    """CLI test for the scraper"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python post_scraper.py <reddit_post_url>")
        print("\nExample URLs:")
        print("  https://www.reddit.com/r/Bard/comments/1p84jda/another_showcase_of_nanobananapro/")
        print("  https://redd.it/1p84jda")
        sys.exit(1)
    
    post_url = sys.argv[1]
    
    scraper = RedditPostScraper()
    result = scraper.scrape_post(post_url)
    
    if result['status'] == 'success':
        print("\n" + "="*60)
        print("✅ Scraping successful!")
        print("="*60)
        print(f"\n📝 Post: {result['post']['title']}")
        print(f"👤 Author: u/{result['post']['author']}")
        print(f"📊 Score: {result['post']['score']}")
        print(f"💬 Comments scraped: {result['comment_count']} / {result['expected_comment_count']}")
        
        # Save to JSON
        output_file = f"reddit_post_{result['post']['id']}.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"\n💾 Saved to: {output_file}")
    else:
        print(f"\n❌ Error: {result['message']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
