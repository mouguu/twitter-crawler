"""
Paginated Scraping Strategy

Basic pagination through Reddit's JSON API.
"""

import time
import requests
from typing import List, Tuple, Optional, Callable
from .base import ScrapingStrategy


class PaginatedStrategy(ScrapingStrategy):
    """分页抓取策略"""
    
    def fetch_posts(
        self,
        target: str,
        max_posts: int,
        progress_callback: Optional[Callable] = None,
        sort_type: str = 'hot',
        time_filter: str = 'all',
        is_user_mode: bool = False
    ) -> List[Tuple[str, str]]:
        """
        Fetch posts using pagination
        
        Args:
            target: Subreddit name or username
            max_posts: Maximum posts to fetch
            progress_callback: Progress callback
            sort_type: Sort type (hot/new/top/best/rising)
            time_filter: Time filter for 'top' sort
            is_user_mode: Whether scraping a user profile
            
        Returns:
            List of (post_url, post_id) tuples
        """
        post_urls = []
        after = None
        page = 1
        consecutive_timeouts = 0
        consecutive_errors = 0
        MAX_CONSECUTIVE_TIMEOUTS = 2 if is_user_mode else 3
        MAX_CONSECUTIVE_ERRORS = 3

        while len(post_urls) < max_posts:
            # Construct API URL
            if is_user_mode:
                api_url = f"https://www.reddit.com/user/{target}/overview.json?limit=100&sort={sort_type}"
            else:
                api_url = f"https://www.reddit.com/r/{target}/{sort_type}.json?limit=100"
            
            if sort_type == 'top' and time_filter:
                api_url += f"&t={time_filter}"
            if after:
                api_url += f"&after={after}"

            try:
                print(f"📄 获取第 {page} 页...", end=" ", flush=True)
                
                # Rate limiting
                base_delay = self.rate_controller.get_delay()
                delay = base_delay + (page % 3) * 0.5
                if delay > 1:
                    print(f"(延迟 {delay:.1f}s)", end=" ", flush=True)
                time.sleep(delay)

                print(f"🌐 Requesting: {api_url}", end=" ", flush=True)
                response = self.session.get_session().get(api_url, timeout=10)
                print(f"⬅️ Status: {response.status_code}", end=" ", flush=True)

                if response.status_code == 403:
                    print("❌ 被阻止")
                    break
                elif response.status_code == 429:
                    print("⚠️ 遇到限流")
                    self._handle_rate_limit()
                    continue
                
                # Check JSON response
                content_type = response.headers.get('Content-Type', '')
                if 'application/json' not in content_type:
                    print(f"⚠️ 非JSON响应")
                    break

                self.rate_controller.record_success()
                consecutive_timeouts = 0
                consecutive_errors = 0
                response.raise_for_status()
                
                
                try:
                    print("📦 Parsing JSON...", end=" ", flush=True)
                    data = response.json()
                    print("✓", end=" ", flush=True)
                except ValueError as e:
                    print(f"\n❌ JSON解析失败: {e}")
                    break
                
                try:
                    posts = data['data']['children']
                    print(f"Found {len(posts)} posts", end=" ", flush=True)
                except (KeyError, TypeError) as e:
                    print(f"\n❌ 数据结构错误: {e}")
                    print(f"Data keys: {data.keys() if isinstance(data, dict) else 'N/A'}")
                    break

                if not posts:
                    print("\n✅ 已获取所有可用帖子", flush=True)
                    break

                new_posts = 0
                print(f"Processing {len(posts)} posts...", end=" ", flush=True)
                
                try:
                    for idx, post in enumerate(posts, 1):
                        try:
                            if len(post_urls) >= max_posts:
                                break
                            
                            try:
                                post_data = post['data']
                                post_id = post_data['id']
                                post_url = f"https://www.reddit.com{post_data['permalink']}"
                                post_urls.append((post_url, post_id))
                                new_posts += 1
                                
                                # Show progress every 25 posts
                                if idx % 25 == 0:
                                    print(f"{idx}...", end=" ", flush=True)
                            except (KeyError, TypeError) as e:
                                print(f"\n⚠️ 跳过格式异常的帖子 #{idx}: {e}", flush=True)
                                continue
                        except Exception as e:
                            print(f"\n❌ 处理帖子 #{idx} 时发生未知错误: {type(e).__name__}: {e}", flush=True)
                            continue
                except Exception as e:
                    print(f"\n❌ enumerate循环错误: {type(e).__name__}: {e}", flush=True)
                    break

                print(f"新增 {new_posts} 个", flush=True)

                # Optimization: If we got fewer posts than the limit (100), we've reached the end
                if len(posts) < 100:
                    print(f" ✅ 本页只有 {len(posts)} 个帖子 (<100)，已到达末尾", flush=True)
                    break

                # Get next page
                after = data['data']['after']
                if not after:
                    print(" ✅ 已到达最后一页", flush=True)
                    break

                page += 1
            
            except requests.exceptions.Timeout:
                consecutive_timeouts += 1
                print(f"⏱️ 请求超时 (10s) [连续{consecutive_timeouts}次]", flush=True)
                if consecutive_timeouts >= 3:
                    print("❌ 连续超时过多，放弃", flush=True)
                    break
                time.sleep(2)
                        
            except Exception as e:
                consecutive_errors += 1
                print(f"❌ 第 {page} 页获取失败: {e} [连续{consecutive_errors}次]", flush=True)
                
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    if len(post_urls) > 0:
                        print(f"💡 连续错误{MAX_CONSECUTIVE_ERRORS}次，停止搜索", flush=True)
                        break
                    else:
                        break
                else:
                    if len(post_urls) > 0 and after:
                        print(f"💡 跳过此页继续", flush=True)
                        page += 1
                        continue
                    else:
                        break

        print(f"\n 📊 总共获取到 {len(post_urls)} 个URL", flush=True)
        return post_urls
