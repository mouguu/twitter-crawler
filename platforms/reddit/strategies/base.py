"""
Base Scraping Strategy Interface

All scraping strategies inherit from this base class.
"""

import time
import random
from abc import ABC, abstractmethod
from typing import List, Tuple, Optional, Callable


class ScrapingStrategy(ABC):
    """抓取策略基类"""
    
    def __init__(self, session, rate_controller):
        """
        Initialize strategy
        
        Args:
            session: HTTP session manager
            rate_controller: Rate limiting controller
        """
        self.session = session
        self.rate_controller = rate_controller
    
    @abstractmethod
    def fetch_posts(
        self, 
        target: str,
        max_posts: int,
        progress_callback: Optional[Callable] = None,
        **kwargs
    ) -> List[Tuple[str, str]]:
        """
        Fetch posts using this strategy
        
        Args:
            target: Subreddit name or username
            max_posts: Maximum number of posts to fetch
            progress_callback: Optional callback for progress updates
            **kwargs: Strategy-specific parameters
            
        Returns:
            List of (post_url, post_id) tuples
        """
        pass
    
    def _handle_rate_limit(self):
        """Handle 429 rate limit errors"""
        self.rate_controller.record_429_error()
        
        if self.rate_controller.needs_session_refresh():
            print("🔄 刷新会话以规避检测...")
            self.session.refresh_session()
            self.rate_controller.mark_session_refreshed()
        
        if self.rate_controller.cooldown_mode:
            print("🧊 冷却模式激活...")
            
            # 模拟人类行为
            wait_time = random.uniform(3, 8)
            print(f"🎭 模拟人类阅读行为，等待 {wait_time:.1f}s")
            time.sleep(wait_time)
            
            # 冷却等待
            cooldown_time = self.rate_controller.get_cooldown_wait_time()
            print(f"❄️ 冷却等待 {cooldown_time:.1f}s...")
            time.sleep(cooldown_time)
        else:
            delay = self.rate_controller.get_delay()
            print(f"⏱️ 常规延迟 {delay:.1f}s...")
            time.sleep(delay)
