#!/usr/bin/env python3
"""
Reddit Scraper CLI Wrapper
Intended to be called from Node.js
"""
import argparse
import json
import sys
import os

# Ensure we can import from the same directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from enhanced_scraper import run_scraping_session

def main():
    parser = argparse.ArgumentParser(description='Reddit Scraper CLI')
    parser.add_argument('--subreddit', type=str, default='UofT', help='Target subreddit')
    parser.add_argument('--max_posts', type=int, default=100, help='Maximum number of posts to scrape')
    parser.add_argument('--strategy', type=str, default='auto', help='Scraping strategy (auto, super_full, super_recent, new)')
    parser.add_argument('--save_json', action='store_true', help='Save individual JSON files')
    parser.add_argument('--mode', type=str, default='subreddit', choices=['subreddit', 'post'], help='Scraping mode: subreddit or single post')
    parser.add_argument('--post_url', type=str, help='Single post URL (for post mode)')
    
    args = parser.parse_args()
    
    # Mode: subreddit or post
    if args.mode == 'post':
        # Single post mode
        if not args.post_url:
            print("❌ Error: --post_url is required for post mode")
            sys.exit(1)
        
        print(f"🚀 Starting Reddit Post Scraper...")
        print(f"📝 Post URL: {args.post_url}")
        
        try:
            from post_scraper import RedditPostScraper
            
            scraper = RedditPostScraper()
            result = scraper.scrape_post(args.post_url)
            
            if result['status'] == 'success':
                # Save to a consistent location
                output_dir = os.path.join(os.getcwd(), 'output', 'reddit')
                os.makedirs(output_dir, exist_ok=True)
                
                output_file = os.path.join(output_dir, f"reddit_post_{result['post']['id']}.json")
                
                # Always save for download
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(result, f, indent=2, ensure_ascii=False)
                print(f"💾 Saved to: {output_file}")
                
                # Format result for Node.js
                output = {
                    'status': 'success',
                    'post': result['post'],
                    'comments': result['comments'],
                    'comment_count': result['comment_count'],
                    'file_path': output_file,  # Always return file path
                    'message': f"Successfully scraped post with {result['comment_count']} comments"
                }
                
                print("\n__JSON_RESULT__")
                print(json.dumps(output))
            else:
                error_result = {
                    'status': 'error',
                    'message': result.get('message', 'Unknown error')
                }
                print("\n__JSON_RESULT__")
                print(json.dumps(error_result))
                sys.exit(1)
                
        except Exception as e:
            error_result = {
                'status': 'error',
                'message': str(e)
            }
            print("\n__JSON_RESULT__")
            print(json.dumps(error_result))
            sys.exit(1)
    
    else:
        # Subreddit mode (existing logic)
        # Map 'auto' strategy based on count if needed, similar to reddit_system.py
        strategy = args.strategy
        if strategy == 'auto':
            if args.max_posts > 5000:
                strategy = 'super_full'
            elif args.max_posts > 2000:
                strategy = 'super_recent'
            else:
                strategy = 'new'
            
        config = {
            'subreddit': args.subreddit,
            'max_posts': args.max_posts,
            'strategy': strategy,
            'save_json': args.save_json,
            'mode': 'incremental'  # Default to incremental for subreddit mode
        }
        
        try:
            print(f"🚀 Starting Reddit Scraper via CLI...")
            print(f"📊 Config: {json.dumps(config, indent=2)}")
            
            result = run_scraping_session(config)
            
            # Output special delimiter and JSON result for Node.js to parse
            print("\n__JSON_RESULT__")
            print(json.dumps(result))
            
        except Exception as e:
            error_result = {
                'status': 'error',
                'message': str(e)
            }
            print("\n__JSON_RESULT__")
            print(json.dumps(error_result))
            sys.exit(1)

if __name__ == "__main__":
    main()
