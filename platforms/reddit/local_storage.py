import os
import json
import csv
import time
from datetime import datetime

class LocalDataManager:
    """
    Local file storage manager for Reddit scraper.
    Replaces Supabase with local JSON/CSV files.
    """
    def __init__(self, base_output_dir="./output/reddit"):
        self.base_output_dir = base_output_dir
        self.current_session_dir = None
        self.posts_file = None
        self.csv_file = None
        self.existing_ids = set()
        self._initialize_session()

    def _initialize_session(self):
        """Initialize a new scraping session directory"""
        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        self.current_session_dir = os.path.join(self.base_output_dir, f"run-{timestamp}")
        os.makedirs(self.current_session_dir, exist_ok=True)
        
        # Create data directories
        self.json_dir = os.path.join(self.current_session_dir, "json")
        os.makedirs(self.json_dir, exist_ok=True)
        
        # Initialize CSV file
        self.csv_path = os.path.join(self.current_session_dir, "posts.csv")
        self._init_csv()
        
        # Load existing IDs from previous runs (optional, for deduplication)
        # For now, we just track IDs in the current session to avoid duplicates
        # In a real scenario, you might want to scan all previous runs or keep a master index
        self._load_existing_ids()

    def _init_csv(self):
        """Initialize CSV file with headers"""
        headers = [
            'post_id', 'title', 'author', 'score', 'url', 
            'created_utc', 'created_date', 'num_comments', 
            'subreddit', 'content_type'
        ]
        with open(self.csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(headers)

    def _load_existing_ids(self):
        """Load existing post IDs to avoid re-scraping"""
        # TODO: Implement loading from a master index if needed
        # For now, start fresh each run or rely on the scraper's logic
        pass

    def save_post(self, post_data):
        """Save a single post to JSON and CSV"""
        post_id = post_data.get('id')
        if not post_id:
            return False
            
        if post_id in self.existing_ids:
            return False

        # Save JSON
        json_path = os.path.join(self.json_dir, f"{post_id}.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(post_data, f, ensure_ascii=False, indent=2)

        # Save to CSV
        self._append_to_csv(post_data)
        
        self.existing_ids.add(post_id)
        return True

    def save_posts_batch(self, posts):
        """Save a batch of posts"""
        count = 0
        for post in posts:
            if self.save_post(post):
                count += 1
        return count

    def _append_to_csv(self, post):
        """Append post summary to CSV"""
        created_utc = post.get('created_utc', 0)
        created_date = datetime.fromtimestamp(created_utc).strftime('%Y-%m-%d %H:%M:%S')
        
        row = [
            post.get('id'),
            post.get('title'),
            post.get('author'),
            post.get('score'),
            post.get('url'),
            created_utc,
            created_date,
            post.get('num_comments'),
            post.get('subreddit'),
            'text' if post.get('selftext') else 'link'
        ]
        
        with open(self.csv_path, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(row)

    def check_post_exists(self, post_id):
        """Check if post exists in current session"""
        return post_id in self.existing_ids

    def get_posts_count(self):
        """Get number of posts saved in this session"""
        return len(self.existing_ids)

    def get_all_posts_iterator(self):
        """Yield all posts from all sessions"""
        if not os.path.exists(self.base_output_dir):
            return

        for run_dir in os.listdir(self.base_output_dir):
            if not run_dir.startswith("run-"):
                continue
            
            json_dir = os.path.join(self.base_output_dir, run_dir, "json")
            if not os.path.exists(json_dir):
                continue

            for filename in os.listdir(json_dir):
                if not filename.endswith(".json"):
                    continue
                
                try:
                    with open(os.path.join(json_dir, filename), 'r', encoding='utf-8') as f:
                        yield json.load(f)
                except Exception:
                    continue

    def get_total_posts_count(self):
        """Count total posts across all sessions"""
        count = 0
        if not os.path.exists(self.base_output_dir):
            return 0
            
        for run_dir in os.listdir(self.base_output_dir):
            if not run_dir.startswith("run-"):
                continue
            json_dir = os.path.join(self.base_output_dir, run_dir, "json")
            if os.path.exists(json_dir):
                count += len([f for f in os.listdir(json_dir) if f.endswith(".json")])
        return count

# Global instance
local_data_manager = LocalDataManager()
