#!/usr/bin/env python3
"""
增强版UofT Reddit爬虫
支持大规模爬取、状态记录、去重功能
"""

import requests
import json
import time
import re
import os
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from local_storage import local_data_manager
import sys

# 添加PRAW支持
try:
    import praw
    PRAW_AVAILABLE = True
    print("🚀 PRAW已安装，将使用Reddit官方API")
except ImportError:
    PRAW_AVAILABLE = False
    print("⚠️ PRAW未安装，使用传统JSON API")

class SmartRateController:
    """智能速率控制器 - 统一管理所有反爬策略"""
    def __init__(self):
        self.base_delay = 1.0
        self.current_delay = 1.0
        self.consecutive_429s = 0
        self.success_streak = 0
        self.last_429_time = 0
        self.total_requests = 0
        self.successful_requests = 0

        # 冷却模式相关
        self.cooldown_mode = False
        self.cooldown_start_time = 0
        self.session_refresh_needed = False

    def record_success(self):
        """记录成功请求"""
        self.total_requests += 1
        self.successful_requests += 1
        self.success_streak += 1
        self.consecutive_429s = 0

        # 如果在冷却模式中成功，可能可以退出冷却模式
        if self.cooldown_mode and self.success_streak >= 3:
            self.exit_cooldown_mode()

        # 连续成功时逐渐减少延迟
        if self.success_streak > 10 and self.current_delay > 0.5:
            self.current_delay *= 0.95

    def record_429_error(self):
        """记录429限流错误"""
        self.total_requests += 1
        self.consecutive_429s += 1
        self.success_streak = 0
        self.last_429_time = time.time()

        # 指数退避策略
        if self.consecutive_429s <= 3:
            self.current_delay *= 2.0
        else:
            self.current_delay *= 1.5

        # 限制最大延迟
        self.current_delay = min(30.0, self.current_delay)

        # 触发冷却模式和会话刷新
        if self.consecutive_429s >= 2:  # 连续2次429就进入冷却模式
            self.enter_cooldown_mode()

    def record_other_error(self):
        """记录其他错误"""
        self.total_requests += 1
        self.success_streak = 0
        # 轻微增加延迟
        self.current_delay *= 1.1

    def get_delay(self):
        """获取当前应该使用的延迟"""
        # 如果最近遇到429，额外增加延迟
        if time.time() - self.last_429_time < 60:
            return self.current_delay * 2
        return max(0.5, self.current_delay)

    def should_skip_strategy(self):
        """判断是否应该跳过当前策略"""
        return self.consecutive_429s >= 5

    def get_success_rate(self):
        """获取成功率"""
        if self.total_requests == 0:
            return 1.0
        return self.successful_requests / self.total_requests

    def enter_cooldown_mode(self):
        """进入冷却模式 - 启用更激进的反制措施"""
        if not self.cooldown_mode:
            self.cooldown_mode = True
            self.cooldown_start_time = time.time()
            self.session_refresh_needed = True
            print(f"🧊 进入冷却模式 (连续{self.consecutive_429s}次429错误)")

    def exit_cooldown_mode(self):
        """退出冷却模式"""
        if self.cooldown_mode:
            self.cooldown_mode = False
            self.session_refresh_needed = False
            print(f"🌡️ 退出冷却模式 (连续{self.success_streak}次成功)")

    def needs_session_refresh(self):
        """检查是否需要刷新会话"""
        return self.session_refresh_needed

    def mark_session_refreshed(self):
        """标记会话已刷新"""
        self.session_refresh_needed = False

    def get_cooldown_wait_time(self):
        """获取冷却模式下的等待时间"""
        if not self.cooldown_mode:
            return 0

        # 根据连续429错误数量决定等待时间
        if self.consecutive_429s <= 3:
            return random.uniform(10, 20)
        elif self.consecutive_429s <= 5:
            return random.uniform(20, 40)
        else:
            return random.uniform(40, 60)

class EnhancedUofTScraper:
    def __init__(self, target_subreddit="UofT"):
        self.main_subreddit = target_subreddit
        # Reddit API配置
        self.reddit_api = None
        if PRAW_AVAILABLE:
            try:
                self.reddit_api = praw.Reddit(
                    client_id="Oe2HbHnaZ_j7guwvxKTL2w",
                    client_secret="nV2EotsgBr0H3pTABCuPkNoMBSqedQ",
                    user_agent="UofT_Enhanced_Scraper_v2.0 by /u/YourUsername"
                )
                print("✅ Reddit官方API已连接")
            except Exception as e:
                print(f"⚠️ Reddit API连接失败，使用备用方案: {e}")
                self.reddit_api = None

        # 多维度突破策略配置
        self.breakthrough_strategies = {
            'time_dimensions': ['hour', 'day', 'week', 'month', 'year', 'all'],
            'sort_methods': ['hot', 'new', 'rising', 'best', 'controversial', 'top'],
            'special_sorts': ['gilded', 'promoted'],  # 如果支持
            'search_operators': ['AND', 'OR', 'NOT', 'site:', 'author:', 'flair:'],
            'time_ranges': ['1h', '6h', '12h', '24h', '3d', '7d', '30d', '90d', '365d']
        }

        # User-Agent轮换池 - 扩展更多真实浏览器
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0'
        ]

        self.headers = {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        }
        self.session = requests.Session()
        self.session.headers.update(self.headers)

        # 智能速率控制器 - 统一的速率控制来源
        self.rate_controller = SmartRateController()

        # 多维度数据源配置
        # 多维度数据源配置
        self.target_subreddits = [
            self.main_subreddit,       # 主要目标
        ]

        # 扩展关键词库 - 多维度突破
        self.extended_keywords = {
            'academic': [
                'course', 'exam', 'grade', 'professor', 'class', 'assignment', 'midterm', 'final',
                'mat137', 'mat135', 'mat136', 'csc148', 'csc165', 'csc236', 'csc207', 'csc209',
                'sta247', 'sta220', 'sta237', 'eco101', 'eco102', 'eco200', 'eco206',
                'phy131', 'phy132', 'che110', 'bio120', 'bio130', 'psy100', 'soc100', 'his103',
                'eng100', 'mat223', 'mat224', 'csc263', 'csc373', 'ece244', 'ece297'
            ],
            'campus_life': [
                'residence', 'dorm', 'housing', 'roommate', 'meal plan', 'dining hall', 'cafeteria',
                'robarts', 'gerstein', 'bahen', 'con hall', 'hart house', 'sid smith', 'medical sciences',
                'trinity', 'victoria', 'innis', 'woodsworth', 'new college', 'university college',
                'st george', 'utm', 'utsc', 'mississauga', 'scarborough'
            ],
            'admin_services': [
                'admission', 'application', 'waitlist', 'acceptance', 'enrollment', 'registration',
                'scholarship', 'osap', 'tuition', 'financial aid', 'bursary', 'fees',
                'acorn', 'quercus', 'degree explorer', 'transcript', 'gpa', 'cgpa'
            ],
            'career_future': [
                'internship', 'co-op', 'job', 'career', 'interview', 'resume', 'cv',
                'pey', 'work study', 'research opportunity', 'grad school', 'graduate school',
                'masters', 'phd', 'thesis', 'supervisor', 'lab', 'research'
            ],
            'social_events': [
                'frosh', 'orientation', 'convocation', 'graduation', 'clubs', 'societies',
                'events', 'parties', 'social', 'friends', 'dating', 'relationships'
            ]
        }



        # 状态记录
        self.scraped_count = 0
        self.skipped_count = 0
        self.error_count = 0

        # 不再预加载所有ID，改为按需批量检查
        # self.existing_post_ids = set()  # 移除这个内存杀手

        # 获取数据库帖子总数（不加载所有ID）
        total_posts = self.get_database_post_count()
        print(f"📊 数据库中已有 {total_posts} 个帖子")

    def refresh_session(self):
        """刷新会话和User-Agent"""
        self.session.close()
        self.session = requests.Session()
        self.headers['User-Agent'] = random.choice(self.user_agents)

        # 添加更多随机headers来模拟真实浏览器
        self.headers.update({
            'Accept-Language': random.choice(['en-US,en;q=0.9', 'en-GB,en;q=0.8', 'en-CA,en;q=0.7']),
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': random.choice(['max-age=0', 'no-cache']),
            'Sec-Ch-Ua': random.choice([
                '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"',
                '"Microsoft Edge";v="120", "Chromium";v="120", "Not_A Brand";v="24"'
            ]),
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': random.choice(['"Windows"', '"macOS"', '"Linux"']),
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        })

        self.session.headers.update(self.headers)
        print(f"🔄 已刷新会话和User-Agent (更真实的浏览器模拟)")

        # 标记会话已刷新
        if hasattr(self, 'rate_controller'):
            self.rate_controller.mark_session_refreshed()

    def simulate_human_behavior(self):
        """简单模拟人类行为 - 随机等待"""
        wait_time = random.uniform(3, 8)
        print(f"🎭 模拟人类阅读行为，等待 {wait_time:.1f}s")
        time.sleep(wait_time)

    def handle_rate_limit_intelligently(self):
        """智能处理429限流 - 统一的反制策略"""
        print(f"⏳ 遇到限流 (连续{self.rate_controller.consecutive_429s}次)")

        # 检查是否需要刷新会话
        if self.rate_controller.needs_session_refresh():
            print("🔄 刷新会话以规避检测...")
            self.refresh_session()

        # 如果在冷却模式，使用更激进的策略
        if self.rate_controller.cooldown_mode:
            print("🧊 冷却模式激活，使用激进反制策略...")

            # 策略1: 模拟人类行为
            self.simulate_human_behavior()

            # 策略2: 冷却等待
            cooldown_time = self.rate_controller.get_cooldown_wait_time()
            print(f"❄️ 冷却等待 {cooldown_time:.1f}s...")
            time.sleep(cooldown_time)
        else:
            # 常规延迟
            delay = self.rate_controller.get_delay()
            print(f"⏱️ 常规延迟 {delay:.1f}s...")
            time.sleep(delay)

    def check_posts_exist_batch(self, post_ids: list) -> set:
        """批量检查帖子是否已存在（内存高效版本，突破1000条限制）"""
        if not post_ids:
            return set()

        try:
            # Local storage check
            existing_ids = set()
            for post_id in post_ids:
                if local_data_manager.check_post_exists(post_id):
                    existing_ids.add(post_id)
            return existing_ids

        except Exception as e:
            print(f"⚠️ 批量检查帖子存在性失败: {e}")
            return set()

    def get_database_post_count(self):
        """获取本地已保存帖子总数"""
        return local_data_manager.get_posts_count()

    def sanitize_filename(self, text, max_length=50):
        """清理文件名"""
        text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        text = re.sub(r'[<>:"/\\|?*]', '', text)
        text = re.sub(r'\s+', '_', text.strip())
        if len(text) > max_length:
            text = text[:max_length]
        return text

    def create_output_directory(self):
        """创建输出目录"""
        # 获取项目根目录
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(os.path.dirname(script_dir))
        
        # 使用项目根目录下的 output/reddit
        data_dir = os.path.join(project_root, 'output', 'reddit')
        
        # 确保Data目录存在
        os.makedirs(data_dir, exist_ok=True)

        # 在Data目录下创建带日期的子目录
        today = datetime.now().strftime("%Y-%m-%d")
        base_dir = os.path.join(data_dir, f"scraped_{today}")

        counter = 1
        while os.path.exists(f"{base_dir}_{counter:03d}"):
            counter += 1

        output_dir = f"{base_dir}_{counter:03d}"
        os.makedirs(output_dir, exist_ok=True)
        print(f"📁 输出目录: {output_dir}")
        return output_dir

    def get_all_posts_paginated(self, max_posts=1000, sort_type='hot', time_filter='all', progress_callback=None):
        """分页获取大量帖子"""
        post_urls = []
        after = None
        page = 1

        # print(f"🔄 开始获取 {sort_type} 模式下的帖子 (最多 {max_posts} 个)...")  # 移到调用处

        while len(post_urls) < max_posts:
            # 构建API URL，添加时间过滤器
            api_url = f"https://www.reddit.com/r/{self.main_subreddit}/{sort_type}.json?limit=100"
            if sort_type == 'top' and time_filter:
                api_url += f"&t={time_filter}"
            if after:
                api_url += f"&after={after}"

            try:
                print(f"📄 获取第 {page} 页...", end=" ", flush=True)
                # 使用智能速率控制，页数越多延迟越长
                base_delay = self.rate_controller.get_delay()
                time.sleep(base_delay + (page % 3) * 0.5)  # 递增延迟

                response = self.session.get(api_url, timeout=30)

                if response.status_code == 403:
                    print("❌ 被阻止，尝试备用方案...")
                    return self.get_posts_backup(max_posts)
                elif response.status_code == 429:
                    # 使用智能速率控制器处理429错误
                    self.rate_controller.record_429_error()
                    self.handle_rate_limit_intelligently()
                    continue

                # 记录成功请求
                self.rate_controller.record_success()
                response.raise_for_status()
                data = response.json()
                posts = data['data']['children']

                if not posts:
                    print("✅ 已获取所有可用帖子")
                    break

                new_posts = 0
                for post in posts:
                    if len(post_urls) >= max_posts:
                        break

                    post_data = post['data']
                    post_id = post_data['id']

                    # 直接收集所有帖子，去重在后续批量处理
                    post_url = f"https://www.reddit.com{post_data['permalink']}"
                    post_urls.append((post_url, post_id))
                    new_posts += 1
                
                if progress_callback:
                    try:
                        progress_callback(0, self.target_posts, f"Gathering candidates ({sort_type}): {len(post_urls)} found...")
                    except:
                        pass

                print(f"新增 {new_posts} 个，跳过 {len(posts) - new_posts} 个重复")

                # 获取下一页参数
                after = data['data']['after']
                if not after:
                    print("✅ 已到达最后一页")
                    break

                page += 1

            except Exception as e:
                print(f"❌ 第 {page} 页获取失败: {e}")
                break

        print(f"📊 总共获取到 {len(post_urls)} 个新帖子URL")
        return post_urls

    def get_posts_backup(self, max_posts):
        """备用获取方案"""
        backup_urls = [
            f"https://www.reddit.com/r/{self.main_subreddit}/.json?limit=100",
            f"https://old.reddit.com/r/{self.main_subreddit}/hot.json?limit=100"
        ]

        for backup_url in backup_urls:
            try:
                print(f"🔄 尝试备用URL...")
                time.sleep(3)

                response = self.session.get(backup_url, timeout=30)
                if response.status_code == 200:
                    data = response.json()
                    posts = data['data']['children']

                    post_urls = []
                    for post in posts[:max_posts]:
                        post_data = post['data']
                        post_id = post_data['id']

                        # 直接收集所有帖子，去重在后续批量处理
                        post_url = f"https://www.reddit.com{post_data['permalink']}"
                        post_urls.append((post_url, post_id))

                    if post_urls:
                        print(f"✅ 备用方案成功，获取到 {len(post_urls)} 个帖子")
                        return post_urls

            except Exception as e:
                print(f"✗ 备用URL失败: {e}")
                continue

        return []

    def filter_new_posts_batch(self, post_urls_with_ids, batch_size=100):
        """批量过滤新帖子（内存高效版本）"""
        if not post_urls_with_ids:
            return []

        new_posts = []

        # 分批处理以避免单次查询过大
        for i in range(0, len(post_urls_with_ids), batch_size):
            batch = post_urls_with_ids[i:i + batch_size]
            post_ids = [post_id for _, post_id in batch]

            # 批量检查这些ID是否存在
            existing_ids = self.check_posts_exist_batch(post_ids)

            # 过滤出新的帖子
            for post_url, post_id in batch:
                if post_id not in existing_ids:
                    new_posts.append((post_url, post_id))

        return new_posts

    def get_recent_posts_multi_strategy(self, max_posts=5000, strategy_type="super_full", progress_callback=None):
        """多策略获取大量最新帖子 - 突破API限制"""
        print(f"🚀 启动超级多策略获取 (目标: {max_posts} 个)")
        print(f"📋 策略类型: {strategy_type}")
        print("=" * 50)
        all_post_urls = []

        # 根据策略类型调整执行顺序和重点
        if strategy_type == "super_recent":
            # 时效优先策略 - 优化执行顺序，最有效的策略优先
            strategies = [
                ("深度历史挖掘", None),      # 最有效，优先执行
                ("时间范围top", ['day', 'week', 'month', 'year']),
                ("最新排序", ['new', 'rising']),
                ("关键词搜索", None)          # 最后执行，带保护
            ]
        elif strategy_type == "super_popular":
            # 热门优先策略
            strategies = [
                ("热门排序", ['hot', 'best']),
                ("时间范围top", ['all', 'year', 'month']),
                ("深度历史挖掘", None),
                ("关键词搜索", None)
            ]
        elif strategy_type == "super_search":
            # 搜索优先策略
            strategies = [
                ("关键词搜索", None),
                ("时间范围top", ['month', 'year', 'all']),
                ("热门排序", ['hot', 'new']),
                ("深度历史挖掘", None)
            ]
        else:
            # 全面策略 (默认) - 多维度突破升级版
            strategies = [
                ("PRAW增强获取", None),        # 新增：使用官方API
                ("时间范围top", ['day', 'week', 'month', 'year', 'all']),
                ("多种排序", ['hot', 'new', 'rising', 'best']),
                ("深度历史挖掘", None),
                ("高级搜索策略", None),        # 新增：高级组合搜索
                ("关键词搜索", None)
            ]

        # 执行策略 - 修复智能饱和度检测逻辑
        strategy_results = []  # 记录每个策略的效果
        consecutive_low_gains = 0  # 连续低收益策略计数

        for strategy_name, params in strategies:
            # 修改退出条件：不仅要看候选帖子数量，还要考虑策略多样性
            # 至少执行前3个策略，确保有足够的多样性来找到新帖子
            strategy_index = strategies.index((strategy_name, params))
            if len(all_post_urls) >= max_posts * 3 and strategy_index >= 2:
                print(f"🎯 已获取足够候选帖子 ({len(all_post_urls)} 个) 且执行了多种策略，停止获取")
                break

            print(f"\n🔄 执行策略: {strategy_name}")
            # 确保remaining不会是负数，至少给每个策略一些搜索配额
            remaining = max(100, max_posts - len(all_post_urls))
            before_count = len(all_post_urls)

            if strategy_name == "PRAW增强获取":
                all_post_urls.extend(self._execute_praw_strategy(remaining, all_post_urls))
            elif strategy_name == "时间范围top":
                all_post_urls.extend(self._execute_time_range_strategy(params, remaining, all_post_urls))
            elif strategy_name in ["多种排序", "最新排序", "热门排序"]:
                all_post_urls.extend(self._execute_sort_strategy(params, remaining, all_post_urls))
            elif strategy_name == "高级搜索策略":
                all_post_urls.extend(self._execute_advanced_search_strategy(remaining, all_post_urls))
            elif strategy_name == "关键词搜索":
                all_post_urls.extend(self._execute_search_strategy(remaining, all_post_urls))
            elif strategy_name in ["深度分页", "深度历史挖掘"]:
                all_post_urls.extend(self._execute_deep_paging_strategy(remaining, all_post_urls))

            # 记录策略效果
            strategy_gain = len(all_post_urls) - before_count
            strategy_results.append(strategy_gain)

            print(f"📊 当前策略新增: {strategy_gain} 个帖子，总计: {len(all_post_urls)} 个")
            
            if progress_callback:
                try:
                    progress_callback(0, self.target_posts, f"Gathering candidates ({strategy_name}): {len(all_post_urls)} found...")
                except:
                    pass

            # 修复的智能饱和度检测 - 只有在真正低收益时才触发
            if strategy_gain < 5:  # 单个策略收益很低
                consecutive_low_gains += 1
            else:
                consecutive_low_gains = 0  # 重置计数器

            # 只有连续多个策略都低收益时才考虑提前结束
            if consecutive_low_gains >= 3 and len(strategy_results) >= 4:
                recent_total = sum(strategy_results[-3:])
                print(f"\n🎯 检测到数据源接近饱和 (最近3个策略仅新增 {recent_total} 个帖子)")

                # 如果已经获得了足够的候选帖子（至少是目标的2倍），可以提前结束
                if len(all_post_urls) >= max_posts * 2:
                    print(f"✅ 已获取足够候选帖子 ({len(all_post_urls)} 个)，提前结束策略执行")
                    break
                else:
                    print(f"🔄 继续执行剩余策略以获取更多候选帖子...")
                    consecutive_low_gains = 0  # 重置，继续尝试

        print(f"\n🎉 超级多策略获取完成！总共获得 {len(all_post_urls)} 个新帖子URL")

        # 如果获得的候选帖子数量远超目标，返回适量的候选帖子
        # 这样可以提高找到新帖子的概率
        if len(all_post_urls) > max_posts * 2:
            return all_post_urls[:max_posts * 2]
        else:
            return all_post_urls

    def _execute_time_range_strategy(self, time_ranges, max_posts, existing_urls):
        """执行时间范围策略"""
        new_urls = []
        for time_range in time_ranges:
            if len(new_urls) >= max_posts:
                break

            print(f"  📅 获取 top({time_range}) 帖子...")
            remaining = max(100, max_posts - len(new_urls))  # 确保至少搜索100个
            posts = self.get_all_posts_paginated(min(remaining, 1000), 'top', time_range)

            # 收集所有帖子，只进行本轮内去重
            batch_new = []
            collected_ids = {post_id for _, post_id in existing_urls + new_urls}

            for post_url, post_id in posts:
                if post_id not in collected_ids:
                    batch_new.append((post_url, post_id))
                    collected_ids.add(post_id)

            new_urls.extend(batch_new)
            print(f"    ✅ top({time_range}) 新增 {len(batch_new)} 个帖子")

        return new_urls

    def _execute_sort_strategy(self, sort_types, max_posts, existing_urls):
        """执行排序策略"""
        new_urls = []
        for sort_type in sort_types:
            if len(new_urls) >= max_posts:
                break

            print(f"  🔄 获取 {sort_type} 帖子...")
            remaining = max(100, max_posts - len(new_urls))  # 确保至少搜索100个
            posts = self.get_all_posts_paginated(min(remaining, 1000), sort_type)

            # 收集所有帖子，只进行本轮内去重
            batch_new = []
            collected_ids = {post_id for _, post_id in existing_urls + new_urls}

            for post_url, post_id in posts:
                if post_id not in collected_ids:
                    batch_new.append((post_url, post_id))
                    collected_ids.add(post_id)

            new_urls.extend(batch_new)
            print(f"    ✅ {sort_type} 新增 {len(batch_new)} 个帖子")

        return new_urls

    def _execute_search_strategy(self, max_posts, existing_urls):
        """执行搜索策略 - 修复统计问题"""
        print(f"  🔍 关键词搜索获取帖子...")
        search_posts = self.search_posts_by_keywords(max_posts)

        new_search_posts = []
        collected_ids = set()

        for post_url, post_id in search_posts:
            # 只检查本轮收集的重复，数据库去重交给filter_new_posts_batch
            if (not any(existing_id == post_id for _, existing_id in existing_urls) and
                post_id not in collected_ids):
                new_search_posts.append((post_url, post_id))
                collected_ids.add(post_id)
            # 移除duplicate_count统计，因为真正的去重在后面进行

        print(f"    ✅ 关键词搜索 找到 {len(search_posts)} 个，新增 {len(new_search_posts)} 个")
        return new_search_posts

    def _execute_deep_paging_strategy(self, max_posts, existing_urls):
        """执行深度历史挖掘策略 - 避免重复已执行的策略"""
        print(f"  📚 深度历史挖掘获取帖子...")
        deep_posts = self.get_deep_historical_posts(max_posts)

        new_deep_posts = []
        collected_ids = set()

        for post_url, post_id in deep_posts:
            # 只检查本轮收集的重复，数据库去重交给filter_new_posts_batch
            if (not any(existing_id == post_id for _, existing_id in existing_urls) and
                post_id not in collected_ids):
                new_deep_posts.append((post_url, post_id))
                collected_ids.add(post_id)

        print(f"    ✅ 深度历史挖掘 找到 {len(deep_posts)} 个，新增 {len(new_deep_posts)} 个")
        return new_deep_posts

    def _execute_praw_strategy(self, max_posts, existing_urls):
        """执行PRAW增强策略（带自动降级）"""
        print(f"  🚀 PRAW增强多维度获取...")
        praw_posts = self.get_praw_enhanced_posts(max_posts)

        # 如果PRAW失败（返回空列表），自动降级到JSON API
        if not praw_posts:
            print(f"  ⚠️ PRAW获取失败，自动降级到JSON API备用方案...")
            # 使用JSON API的多种排序方式作为备用
            backup_posts = []
            for sort_type in ['hot', 'new', 'top']:
                try:
                    print(f"    🔄 备用方案: {sort_type} 排序...")
                    batch_posts = self.get_all_posts_paginated(min(max_posts//3, 500), sort_type)
                    backup_posts.extend(batch_posts)
                    if len(backup_posts) >= max_posts:
                        break
                except Exception as e:
                    print(f"    ✗ {sort_type} 备用方案失败: {e}")
                    continue
            praw_posts = backup_posts[:max_posts]
            if praw_posts:
                print(f"    ✅ 备用方案成功获取 {len(praw_posts)} 个帖子")

        new_praw_posts = []
        collected_ids = set()

        for post_url, post_id in praw_posts:
            # 只检查本轮收集的重复，数据库去重交给filter_new_posts_batch
            if (not any(existing_id == post_id for _, existing_id in existing_urls) and
                post_id not in collected_ids):
                new_praw_posts.append((post_url, post_id))
                collected_ids.add(post_id)

        print(f"    ✅ PRAW策略 找到 {len(praw_posts)} 个，新增 {len(new_praw_posts)} 个")
        return new_praw_posts

    def _execute_advanced_search_strategy(self, max_posts, existing_urls):
        """执行高级搜索策略"""
        print(f"  🔍 高级搜索策略获取...")
        search_posts = self.get_advanced_search_posts(max_posts)

        new_search_posts = []
        collected_ids = set()

        for post_url, post_id in search_posts:
            # 只检查本轮收集的重复，数据库去重交给filter_new_posts_batch
            if (not any(existing_id == post_id for _, existing_id in existing_urls) and
                post_id not in collected_ids):
                new_search_posts.append((post_url, post_id))
                collected_ids.add(post_id)

        print(f"    ✅ 高级搜索 找到 {len(search_posts)} 个，新增 {len(new_search_posts)} 个")
        return new_search_posts

    def search_posts_by_keywords(self, max_posts=2000):
        """通过关键词搜索获取更多帖子 - 优化关键词库"""
        # 分类关键词，提高搜索效率
        academic_keywords = [
            'course', 'exam', 'grade', 'professor', 'class', 'assignment', 'midterm', 'final',
            'mat137', 'mat135', 'csc148', 'csc165', 'csc236', 'sta247', 'sta220', 'eco101', 'eco102',
            'phy131', 'phy132', 'che110', 'bio120', 'psy100', 'soc100', 'his103'
        ]

        life_keywords = [
            'residence', 'dorm', 'housing', 'roommate', 'meal plan', 'dining hall',
            'robarts', 'gerstein', 'bahen', 'con hall', 'hart house', 'sid smith',
            'trinity', 'victoria', 'innis', 'woodsworth', 'new college', 'university college'
        ]

        admin_keywords = [
            'admission', 'application', 'waitlist', 'acceptance', 'enrollment',
            'scholarship', 'osap', 'tuition', 'financial aid', 'bursary',
            'acorn', 'quercus', 'degree explorer', 'transcript'
        ]

        career_keywords = [
            'internship', 'co-op', 'job', 'career', 'interview', 'resume',
            'pey', 'work study', 'research opportunity', 'grad school'
        ]

        # 合并所有关键词
        keywords = academic_keywords + life_keywords + admin_keywords + career_keywords

        post_urls = []
        all_found_posts = set()  # 用于关键词间去重
        # 确保每个关键词至少搜索1个帖子，即使max_posts是负数
        posts_per_keyword = max(1, max(100, max_posts) // len(keywords))
        total_found = 0
        total_duplicates = 0

        print(f"  📊 开始搜索 {len(keywords)} 个关键词...")

        # 检查是否应该跳过搜索策略
        if self.rate_controller.should_skip_strategy():
            print(f"  🛑 速率控制建议跳过关键词搜索 (连续{self.rate_controller.consecutive_429s}次429错误)")
            return []

        for i, keyword in enumerate(keywords, 1):
            if len(post_urls) >= max_posts:
                break

            # 如果速率控制建议跳过，提前结束
            if self.rate_controller.should_skip_strategy():
                print(f"  🛑 速率控制建议跳过剩余 {len(keywords) - i + 1} 个关键词")
                break

            try:
                search_url = "https://www.reddit.com/r/UofT/search.json"
                params = {
                    'q': keyword,
                    'sort': 'relevance',  # 改为相关性排序，获得更好的结果
                    'limit': 100,
                    'restrict_sr': 1,
                    't': 'all'
                }

                if i % 10 == 0:  # 每10个关键词显示一次进度
                    print(f"  📈 进度: {i}/{len(keywords)} 关键词，已找到 {len(post_urls)} 个新帖子")

                time.sleep(self.rate_controller.get_delay() * 2)  # 关键词搜索使用2倍延迟
                response = self.session.get(search_url, params=params, timeout=30)

                if response.status_code == 200:
                    self.rate_controller.record_success()
                    data = response.json()
                    posts = data['data']['children']
                    total_found += len(posts)

                    keyword_new = 0
                    keyword_duplicates = 0

                    for post in posts:
                        if len(post_urls) >= max_posts:
                            break

                        post_data = post['data']
                        post_id = post_data['id']

                        # 只检查本轮关键词间的重复，数据库去重交给filter_new_posts_batch
                        if post_id not in all_found_posts:
                            post_url = f"https://www.reddit.com{post_data['permalink']}"
                            post_urls.append((post_url, post_id))
                            all_found_posts.add(post_id)
                            keyword_new += 1
                        else:
                            keyword_duplicates += 1

                    total_duplicates += keyword_duplicates

                    if keyword_new > 0:
                        print(f"  🔎 {keyword}: +{keyword_new} 新帖子")

                else:
                    if response.status_code == 429:
                        self.rate_controller.record_429_error()
                        print(f"  ✗ {keyword}: 搜索限流 (429)")
                    else:
                        self.rate_controller.record_other_error()
                        print(f"  ✗ {keyword}: 搜索失败 ({response.status_code})")

            except Exception as e:
                self.rate_controller.record_other_error()
                print(f"  ✗ {keyword}: 搜索出错 ({e})")
                continue

        print(f"  📊 关键词搜索完成: 总共找到 {total_found} 个帖子，新增 {len(post_urls)} 个，跳过 {total_duplicates} 个重复")
        return post_urls

    def get_advanced_search_posts(self, max_posts=3000):
        """高级搜索策略 - 多维度组合搜索"""
        if not self.reddit_api:
            print("⚠️ PRAW不可用，跳过高级搜索")
            return []

        print("🔍 启动高级多维度搜索...")
        post_urls = []
        subreddit = self.reddit_api.subreddit('UofT')

        # 高级搜索组合
        advanced_searches = [
            # 学术相关组合搜索
            "course AND (grade OR mark OR exam)",
            "professor AND (review OR rating OR recommend)",
            "assignment AND (help OR question OR due)",
            "midterm OR final OR test OR quiz",

            # 课程代码组合
            "MAT137 OR MAT135 OR MAT136",
            "CSC148 OR CSC165 OR CSC236 OR CSC207",
            "STA247 OR STA220 OR STA237",
            "ECO101 OR ECO102 OR ECO200",

            # 校园生活组合
            "residence OR dorm OR housing OR roommate",
            "robarts OR gerstein OR bahen OR library",
            "trinity OR victoria OR innis OR college",

            # 申请和行政
            "admission OR application OR waitlist",
            "scholarship OR osap OR financial",
            "acorn OR quercus OR registration",

            # 职业发展
            "internship OR co-op OR job OR career",
            "pey OR work OR research OR lab",
            "grad school OR graduate OR masters OR phd",

            # 按年份搜索 (时间维度)
            "2024", "2023", "2022", "2021", "2020",

            # 按学期搜索
            "fall 2024", "winter 2024", "summer 2024",
            "fall 2023", "winter 2023", "summer 2023",

            # 特殊话题
            "covid OR pandemic OR online OR remote",
            "strike OR protest OR tuition increase",
            "mental health OR stress OR anxiety",
            "dating OR relationship OR social"
        ]

        for search_query in advanced_searches:
            if len(post_urls) >= max_posts:
                break

            try:
                print(f"  🔎 高级搜索: {search_query[:50]}...")

                # 使用PRAW搜索，支持更复杂的查询
                search_results = subreddit.search(
                    search_query,
                    sort='relevance',
                    time_filter='all',
                    limit=1000
                )

                batch_new = 0
                for submission in search_results:
                    if len(post_urls) >= max_posts:
                        break

                    post_id = submission.id
                    # 直接收集，数据库去重交给filter_new_posts_batch
                    post_url = f"https://www.reddit.com{submission.permalink}"
                    post_urls.append((post_url, post_id))
                    batch_new += 1

                if batch_new > 0:
                    print(f"    ✅ 新增 {batch_new} 个帖子")

                time.sleep(self.rate_controller.get_delay())  # 智能速率控制

            except Exception as e:
                print(f"    ✗ 搜索失败: {e}")
                continue

        print(f"🎉 高级搜索完成，总共获得 {len(post_urls)} 个新帖子")
        return post_urls

    def get_deep_historical_posts(self, max_posts=1000):
        """深度历史挖掘 - 使用不同的策略组合避免重复"""
        post_urls = []

        # 使用不同的排序+时间组合，避免重复已执行的策略
        historical_configs = [
            ('hot', 'year'), ('hot', 'all'),
            ('best', 'year'), ('best', 'all'),
            ('controversial', 'month'), ('controversial', 'year'), ('controversial', 'all'),
            ('gilded', 'year'), ('gilded', 'all')  # 如果支持的话
        ]

        for sort_type, time_filter in historical_configs:
            if len(post_urls) >= max_posts:
                break

            print(f"  🏛️ 历史挖掘: {sort_type}({time_filter})")

            # 深度分页获取
            after = None
            page = 1
            max_pages = 20  # 更深的分页

            while page <= max_pages and len(post_urls) < max_posts:
                try:
                    api_url = f"https://www.reddit.com/r/UofT/{sort_type}.json?limit=100&t={time_filter}"
                    if after:
                        api_url += f"&after={after}"

                    # 使用智能速率控制
                    time.sleep(self.rate_controller.get_delay())
                    response = self.session.get(api_url, timeout=30)

                    if response.status_code == 200:
                        self.rate_controller.record_success()
                        data = response.json()
                        posts = data['data']['children']

                        if not posts:
                            break

                        page_new = 0
                        for post in posts:
                            if len(post_urls) >= max_posts:
                                break

                            post_data = post['data']
                            post_id = post_data['id']

                            # 直接收集，数据库去重交给filter_new_posts_batch
                            post_url = f"https://www.reddit.com{post_data['permalink']}"
                            post_urls.append((post_url, post_id))
                            page_new += 1

                        if page_new > 0:
                            print(f"    📄 第{page}页: +{page_new} 个帖子")

                        # 获取下一页参数
                        after = data['data']['after']
                        if not after:
                            break

                        page += 1
                    else:
                        if response.status_code == 429:
                            self.rate_controller.record_429_error()
                            print(f"    ⚠️ 遇到限流，延迟 {self.rate_controller.get_delay():.1f}s")
                            time.sleep(self.rate_controller.get_delay())
                        elif response.status_code == 404:
                            print(f"    ⚠️ {sort_type}排序不支持，跳过")
                            break
                        else:
                            self.rate_controller.record_other_error()
                            print(f"    ✗ 第{page}页失败: {response.status_code}")
                            break

                except Exception as e:
                    print(f"    ✗ 第{page}页出错: {e}")
                    break

        return post_urls

    def get_praw_enhanced_posts(self, max_posts=2000):
        """使用PRAW API获取更多帖子 - 多维度突破"""
        if not self.reddit_api:
            print("⚠️ PRAW不可用，跳过增强获取")
            return []

        print("🚀 启动PRAW增强多维度获取...")
        post_urls = []
        subreddit = self.reddit_api.subreddit('UofT')

        # 1. 扩展时间维度获取
        time_methods = [
            ('hot', None), ('new', None), ('rising', None), ('best', None),
            ('top', 'hour'), ('top', 'day'), ('top', 'week'),
            ('top', 'month'), ('top', 'year'), ('top', 'all'),
            ('controversial', 'day'), ('controversial', 'week'),
            ('controversial', 'month'), ('controversial', 'year'), ('controversial', 'all')
        ]

        for sort_method, time_filter in time_methods:
            # 修改退出条件：允许收集更多候选帖子以提高找到新帖子的概率
            # 至少执行前几个重要的方法
            method_index = time_methods.index((sort_method, time_filter))
            if len(post_urls) >= max_posts * 3 and method_index >= 4:
                print(f"  🎯 已收集足够候选帖子 ({len(post_urls)} 个)，停止PRAW获取")
                break

            try:
                print(f"  🔄 PRAW获取: {sort_method}({time_filter if time_filter else 'default'})")

                if sort_method == 'hot':
                    submissions = subreddit.hot(limit=1000)
                elif sort_method == 'new':
                    submissions = subreddit.new(limit=1000)
                elif sort_method == 'rising':
                    submissions = subreddit.rising(limit=1000)
                elif sort_method == 'best':
                    submissions = subreddit.best(limit=1000)
                elif sort_method == 'top':
                    submissions = subreddit.top(time_filter=time_filter, limit=1000)
                elif sort_method == 'controversial':
                    submissions = subreddit.controversial(time_filter=time_filter, limit=1000)
                else:
                    continue

                batch_new = 0
                for submission in submissions:
                    # 移除单个方法内的提前退出，让每个方法都能完整执行
                    post_id = submission.id
                    # 直接收集，数据库去重交给filter_new_posts_batch
                    post_url = f"https://www.reddit.com{submission.permalink}"
                    post_urls.append((post_url, post_id))
                    batch_new += 1

                print(f"    ✅ {sort_method}({time_filter if time_filter else 'default'}) 新增 {batch_new} 个帖子")

            except Exception as e:
                print(f"    ✗ {sort_method}({time_filter if time_filter else 'default'}) 失败: {e}")
                continue

        print(f"🎉 PRAW增强获取完成，总共获得 {len(post_urls)} 个新帖子")
        return post_urls

    def get_deep_paginated_posts(self, max_posts=1000):
        """深度分页获取历史帖子 - 突破分页限制"""
        post_urls = []

        # 使用多种排序方式进行深度分页
        sort_configs = [
            ('top', 'month'), ('top', 'year'), ('top', 'all'),
            ('hot', None), ('new', None)
        ]

        for sort_type, time_filter in sort_configs:
            if len(post_urls) >= max_posts:
                break

            print(f"  📚 深度分页: {sort_type}({time_filter if time_filter else 'default'})")

            # 尝试获取更多页面
            after = None
            page = 1
            max_pages = 15  # 增加页面数量

            while page <= max_pages and len(post_urls) < max_posts:
                try:
                    api_url = f"https://www.reddit.com/r/UofT/{sort_type}.json?limit=100"
                    if time_filter:
                        api_url += f"&t={time_filter}"
                    if after:
                        api_url += f"&after={after}"

                    # 使用智能速率控制，页数越多延迟越长
                    base_delay = self.rate_controller.get_delay()
                    time.sleep(base_delay + (page % 5) * 0.2)  # 递增延迟
                    response = self.session.get(api_url, timeout=30)

                    if response.status_code == 200:
                        data = response.json()
                        posts = data['data']['children']

                        if not posts:
                            break

                        page_new = 0
                        for post in posts:
                            if len(post_urls) >= max_posts:
                                break

                            post_data = post['data']
                            post_id = post_data['id']

                            # 直接收集，数据库去重交给filter_new_posts_batch
                            post_url = f"https://www.reddit.com{post_data['permalink']}"
                            post_urls.append((post_url, post_id))
                            page_new += 1

                        print(f"    📄 第{page}页: +{page_new} 个帖子")

                        # 获取下一页参数
                        after = data['data']['after']
                        if not after:
                            break

                        page += 1
                    else:
                        print(f"    ✗ 第{page}页失败: {response.status_code}")
                        break

                except Exception as e:
                    print(f"    ✗ 第{page}页出错: {e}")
                    break

        return post_urls

    def search_posts_by_timeframe(self, max_posts=1000):
        """使用Reddit搜索API按时间段获取帖子"""
        post_urls = []

        # 搜索不同时间段的帖子
        import time
        from datetime import datetime, timedelta

        # 搜索最近30天的帖子，按周分段
        for weeks_ago in range(0, 12):  # 最近12周
            if len(post_urls) >= max_posts:
                break

            # 计算时间范围
            end_date = datetime.now() - timedelta(weeks=weeks_ago)
            start_date = end_date - timedelta(weeks=1)

            # 转换为Unix时间戳
            end_timestamp = int(end_date.timestamp())
            start_timestamp = int(start_date.timestamp())

            try:
                # 使用Reddit搜索API
                search_url = f"https://www.reddit.com/r/UofT/search.json"
                params = {
                    'q': 'subreddit:UofT',
                    'sort': 'new',
                    'limit': 100,
                    'restrict_sr': 1,
                    't': 'all'
                }

                print(f"📅 搜索 {start_date.strftime('%Y-%m-%d')} 到 {end_date.strftime('%Y-%m-%d')} 的帖子...")
                time.sleep(self.rate_controller.get_delay())

                response = self.session.get(search_url, params=params, timeout=30)

                if response.status_code == 200:
                    data = response.json()
                    posts = data['data']['children']

                    week_posts = 0
                    for post in posts:
                        if len(post_urls) >= max_posts:
                            break

                        post_data = post['data']
                        post_id = post_data['id']
                        created_utc = post_data['created_utc']

                        # 检查时间范围（数据库去重交给filter_new_posts_batch）
                        if start_timestamp <= created_utc <= end_timestamp:
                            post_url = f"https://www.reddit.com{post_data['permalink']}"
                            post_urls.append((post_url, post_id))
                            week_posts += 1

                    print(f"  ✅ 该周新增 {week_posts} 个帖子")
                else:
                    print(f"  ⚠️ 搜索失败: {response.status_code}")

            except Exception as e:
                print(f"  ❌ 搜索出错: {e}")
                continue

        return post_urls

    def scrape_post_with_comments(self, post_url, post_id):
        """抓取单个帖子及其评论"""
        try:
            # 不需要再次检查重复，因为URL获取阶段已经过滤了
            json_url = post_url.rstrip('/') + '.json'
            response = self.session.get(json_url, timeout=30)

            # 使用智能速率控制器处理429限流错误
            if response.status_code == 429:
                self.rate_controller.record_429_error()
                self.handle_rate_limit_intelligently()

                # 重试一次
                response = self.session.get(json_url, timeout=30)
                if response.status_code == 429:
                    print("⏭️ 仍然被限流，跳过此帖子继续下一个")
                    return None

            # 记录成功请求
            self.rate_controller.record_success()

            response.raise_for_status()

            data = response.json()

            # 提取帖子信息
            post_info = data[0]['data']['children'][0]['data']

            # 提取评论
            comments_data = data[1]['data']['children'] if len(data) > 1 else []
            comments = self.extract_comments(comments_data)

            post_data = {
                'id': post_info['id'],
                'title': post_info['title'],
                'author': post_info.get('author', '[deleted]'),
                'score': post_info.get('score', 0),
                'selftext': post_info.get('selftext', ''),
                'url': post_url,
                'created_utc': post_info.get('created_utc', 0),
                'num_comments': post_info.get('num_comments', 0),
                'comments': comments
            }

            return post_data

        except Exception as e:
            self.error_count += 1
            print(f"❌ 抓取失败: {e}")
            return None

    def extract_comments(self, comments_data):
        """递归提取评论"""
        comments = []

        for comment_item in comments_data:
            if comment_item['kind'] == 't1':  # 评论类型
                comment_data = comment_item['data']

                if comment_data.get('body') and comment_data['body'] != '[deleted]':
                    comment = {
                        'id': comment_data['id'],
                        'author': comment_data.get('author', '[deleted]'),
                        'body': comment_data['body'],
                        'score': comment_data.get('score', 0),
                        'replies': []
                    }

                    # 递归处理回复
                    if 'replies' in comment_data and comment_data['replies']:
                        if isinstance(comment_data['replies'], dict):
                            replies_data = comment_data['replies']['data']['children']
                            comment['replies'] = self.extract_comments(replies_data)

                    comments.append(comment)

        return comments

    def save_to_database(self, post_data, max_retries=3):
        """保存到数据库（带重试机制）"""
        for attempt in range(max_retries):
            try:
                # 准备数据库记录
                db_record = {
                    'post_id': post_data['id'],
                    'title': post_data['title'],
                    'author': post_data['author'],
                    'score': post_data['score'],
                    'num_comments': post_data['num_comments'],
                    'created_utc': int(float(post_data['created_utc'])),  # 先转换为浮点数再转换为整数
                    'data': post_data
                }

                # 插入数据库
                # Save to local storage
                local_data_manager.save_post(db_record)

                if result.data:
                    # 数据库保存成功（不再维护内存缓存）
                    return True
                else:
                    return False

            except Exception as e:
                error_str = str(e)

                # 如果是重复键错误，说明数据已存在，视为成功
                if 'duplicate key value violates unique constraint' in error_str:
                    print(f"ℹ️ 帖子已存在于数据库中，跳过: {post_data['id']}")
                    return True

                if attempt < max_retries - 1:
                    print(f"⚠️ 数据库保存失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                    print(f"🔄 等待 {(attempt + 1) * 2} 秒后重试...")
                    time.sleep((attempt + 1) * 2)  # 递增等待时间：2s, 4s, 6s
                else:
                    print(f"❌ 数据库保存失败 (已重试 {max_retries} 次): {e}")
                    return False

    def run_enhanced_scraping(self, max_posts=500, sort_type='hot', save_json=True, progress_callback=None):
        """运行增强版爬取"""
        print("🚀 启动增强版UofT Reddit爬虫")
        print("=" * 60)

        # 计算需要爬取的新帖子数量
        existing_count = self.get_database_post_count()
        needed_posts = max_posts  # 用户指定的就是要爬取的新帖子数量

        print(f"📊 目标: 爬取 {max_posts} 个新帖子，数据库中已有: {existing_count} 个帖子")

        # 如果需要的帖子数很少，适度增加搜索范围以提高找到新帖子的概率
        # 优化：如果数据库为空，不需要太大的倍数，因为所有找到的帖子都是新的
        if existing_count == 0:
            search_multiplier = 1.2  # 稍微多一点点即可
        elif needed_posts <= 10:
            # 对于很少的目标，搜索更多候选以提高成功率
            search_multiplier = 7
        elif needed_posts <= 50:
            search_multiplier = 5
        elif needed_posts <= 200:
            search_multiplier = 3
        else:
            search_multiplier = 2

        actual_search_target = min(needed_posts * search_multiplier, 1000)  # 最多搜索1000个候选
        print(f"🔍 为了找到 {needed_posts} 个新帖子，将搜索 {actual_search_target} 个候选帖子")
        self.target_posts = max_posts  # 记录目标数量

        # 创建输出目录
        output_dir = self.create_output_directory() if save_json else None

        # 获取帖子URL列表（使用扩大的搜索范围）
        if sort_type.startswith('super'):
            # 超级模式：使用多策略突破API限制
            print(f"🚀 启用超级模式获取海量帖子 (搜索: {actual_search_target} 个候选)")
            post_urls = self.get_recent_posts_multi_strategy(actual_search_target, sort_type, progress_callback)
        elif sort_type == 'new' and needed_posts > 1000:
            # 对于大量新帖子需求，使用多策略方法
            print(f"🚀 启用多策略模式获取大量最新帖子 (搜索: {actual_search_target} 个候选)")
            post_urls = self.get_recent_posts_multi_strategy(actual_search_target, "super_recent", progress_callback)
        else:
            # 常规单一策略，但也使用扩大的搜索范围
            print(f"🔄 开始获取 {sort_type} 模式下的帖子 (搜索: {actual_search_target} 个候选)...")
            post_urls = self.get_all_posts_paginated(actual_search_target, sort_type, progress_callback=progress_callback)

        # 如果单一排序方式获取不够，尝试其他排序方式
        if len(post_urls) < needed_posts:
            remaining_needed = needed_posts - len(post_urls)
            print(f"⚠️ {sort_type} 模式只获取到 {len(post_urls)} 个帖子，还需要 {remaining_needed} 个")

            # 尝试其他排序方式，包括不同时间范围的top
            other_sorts = []
            if sort_type != 'new':
                other_sorts.append(('new', None))
            if sort_type != 'best':
                other_sorts.append(('best', None))
            if sort_type != 'top':
                other_sorts.extend([('top', 'all'), ('top', 'year'), ('top', 'month'), ('top', 'week')])
            if sort_type != 'rising':
                other_sorts.append(('rising', None))

            for backup_sort, time_filter in other_sorts:
                if len(post_urls) >= needed_posts:
                    break

                sort_desc = f"{backup_sort}({time_filter})" if time_filter else backup_sort
                print(f"🔄 尝试 {sort_desc} 模式获取更多帖子...")
                backup_urls = self.get_all_posts_paginated(remaining_needed, backup_sort, time_filter, progress_callback=progress_callback)

                if backup_urls:
                    post_urls.extend(backup_urls)
                    remaining_needed = needed_posts - len(post_urls)
                    print(f"✅ {backup_sort} 模式新增 {len(backup_urls)} 个帖子，总计: {len(post_urls)}")

                    if len(post_urls) >= needed_posts:
                        post_urls = post_urls[:needed_posts]  # 截取到目标数量
                        break

        if not post_urls:
            print("❌ 没有获取到新的帖子URL")
            return

        print(f"📊 获取到 {len(post_urls)} 个候选帖子URL")

        # 批量过滤已存在的帖子（最终去重检查）
        print("🔍 执行最终去重检查...")
        post_urls = self.filter_new_posts_batch(post_urls)
        print(f"✅ 去重后剩余 {len(post_urls)} 个新帖子待处理")

        if len(post_urls) == 0:
            print("⚠️ 所有候选帖子都已存在于数据库中")
            print("💡 建议：尝试不同的策略或等待新帖子发布")
            return

        print(f"\n🎯 开始抓取 {len(post_urls)} 个帖子...")
        print("=" * 60)

        scraped_posts = []  # 用于最终统计和热门帖子分析
        posts_to_save = []  # 批量保存缓冲区
        start_time = time.time()
        # 当目标很小时，使用更小的批量大小以便及时停止
        BATCH_SIZE = min(10, needed_posts) if needed_posts <= 20 else 50

        for i, (post_url, post_id) in enumerate(post_urls, 1):
            # 检查是否已达到目标帖子数
            if self.scraped_count >= max_posts:
                print(f"\n🎉 已达到目标！已成功爬取 {self.scraped_count} 个新帖子，停止处理")
                break

            print(f"\n[{i}/{len(post_urls)}] 处理帖子: {post_id}")

            # 抓取帖子数据
            post_data = self.scrape_post_with_comments(post_url, post_id)

            if post_data:
                # 保留用于统计
                scraped_posts.append(post_data)
                self.scraped_count += 1

                # 可选：保存JSON文件
                json_status = ""
                if save_json and output_dir:
                    try:
                        title_clean = self.sanitize_filename(post_data['title'], 60)
                        filename = f"{output_dir}/{post_data['id']}_{title_clean}.json"

                        with open(filename, 'w', encoding='utf-8') as f:
                            json.dump(post_data, f, ensure_ascii=False, indent=2)

                        json_status = "💾 JSON已保存"
                    except Exception as e:
                        json_status = f"⚠️ JSON保存失败: {str(e)[:30]}..."

                # 状态显示
                print(f"✅ {post_data['title'][:50]}...")
                print(f"    👤 作者: {post_data['author']} | 📈 分数: {post_data['score']} | 💬 评论: {len(post_data['comments'])}")
                if json_status:
                    print(f"    {json_status}")
                
                # 发送进度回调
                if progress_callback:
                    try:
                        progress_callback(self.scraped_count, max_posts, f"Scraped: {post_data['title'][:30]}...")
                    except Exception as e:
                        print(f"⚠️ Progress callback failed: {e}")

                # 当目标很小时，立即保存每个帖子以便及时停止
                if needed_posts <= 20:
                    # 小目标：立即保存
                    print(f"🔄 立即保存帖子到数据库...")
                    if local_data_manager.save_post(post_data):
                        print(f"✅ 保存成功")
                        if self.scraped_count >= max_posts:
                            print(f"🎉 已达到目标！已成功爬取 {self.scraped_count} 个新帖子，停止处理")
                            break
                    else:
                        print(f"❌ 保存失败")
                else:
                    # 大目标：批量保存
                    posts_to_save.append(post_data)
                    if len(posts_to_save) >= BATCH_SIZE or i == len(post_urls):
                        print(f"🔄 批量保存 {len(posts_to_save)} 个帖子到数据库...")
                        saved_count = local_data_manager.save_posts_batch(posts_to_save)
                        if saved_count > 0:
                            print(f"✅ 批量保存成功: {saved_count}/{len(posts_to_save)} 个帖子")

                            # 保存后再次检查是否达到目标
                            if self.scraped_count >= max_posts:
                                print(f"🎉 已达到目标！已成功爬取 {self.scraped_count} 个新帖子，停止处理")
                                break
                        else:
                            print(f"❌ 批量保存失败")
                        posts_to_save = []  # 清空缓冲区

            # 动态进度显示 - 根据总数调整频率
            progress_interval = max(10, len(post_urls) // 100)  # 至少每10个，最多100次报告
            if i % progress_interval == 0:
                elapsed = time.time() - start_time
                avg_time = elapsed / i
                remaining = (len(post_urls) - i) * avg_time

                # 计算成功率
                success_rate = (self.scraped_count / i) * 100 if i > 0 else 0

                print(f"\n📊 进度报告: {i}/{len(post_urls)} ({i/len(post_urls)*100:.1f}%)")
                print(f"   ⚡ 平均速度: {avg_time:.1f}s/帖 | 成功率: {success_rate:.1f}%")
                print(f"   ⏰ 预计剩余: {remaining/60:.1f}分钟 | 已用时: {elapsed/60:.1f}分钟")

            # 使用智能速率控制器的延迟
            if i < len(post_urls):
                delay = self.rate_controller.get_delay()
                # 添加一些随机性以模拟人类行为
                delay = random.uniform(delay * 0.8, delay * 1.2)
                time.sleep(delay)

        # 检查是否达到目标，如果没有则尝试其他策略
        current_count = self.get_database_post_count()
        if current_count < max_posts and len(post_urls) > 0:
            remaining_needed = max_posts - current_count
            print(f"\n🎯 当前数据库有 {current_count} 个帖子，距离目标 {max_posts} 还需要 {remaining_needed} 个")

            if remaining_needed > 0:
                print("🔄 尝试其他策略获取更多帖子...")

                # 尝试不同的策略
                backup_strategies = ['new', 'top', 'rising']
                for backup_strategy in backup_strategies:
                    if backup_strategy != sort_type:  # 避免重复相同策略
                        print(f"🔄 尝试 {backup_strategy} 策略...")
                        backup_urls = self.get_all_posts_paginated(remaining_needed * 3, backup_strategy)
                        backup_urls = self.filter_new_posts_batch(backup_urls)

                        if backup_urls:
                            print(f"✅ {backup_strategy} 策略找到 {len(backup_urls)} 个新帖子")
                            # 处理这些新帖子（简化版，不重复所有逻辑）
                            for post_url, post_id in backup_urls[:remaining_needed]:
                                post_data = self.scrape_post_with_comments(post_url, post_id)
                                if post_data:
                                    local_data_manager.save_post(post_data)
                                    scraped_posts.append(post_data)
                                    self.scraped_count += 1
                                    print(f"✅ 额外抓取: {post_data['title'][:50]}...")

                                    # 检查是否达到目标
                                    current_count = self.get_database_post_count()
                                    if current_count >= max_posts:
                                        print(f"🎉 达到目标！数据库现有 {current_count} 个帖子")
                                        break
                            break

        # 最终统计
        self.print_final_stats(scraped_posts, output_dir, start_time)
        
        return {
            'scraped_posts': scraped_posts,
            'output_dir': output_dir
        }

    def print_final_stats(self, scraped_posts, output_dir, start_time):
        """打印最终统计信息"""
        elapsed_time = time.time() - start_time

        print("\n" + "=" * 60)
        print("🎉 爬取完成！")
        print("=" * 60)

        print(f"📊 统计信息:")
        print(f"   ✅ 成功抓取: {self.scraped_count} 个帖子")
        print(f"   ⏭️  跳过重复: {self.skipped_count} 个帖子")
        print(f"   ❌ 失败: {self.error_count} 个帖子")
        print(f"   ⏱️  总耗时: {elapsed_time/60:.1f} 分钟")
        print(f"   ⚡ 平均速度: {elapsed_time/max(1, self.scraped_count):.1f} 秒/帖")

        if output_dir:
            print(f"   📁 JSON文件保存在: {output_dir}/")

        # 数据库统计
        try:
            total_in_db = local_data_manager.get_posts_count()
            print(f"   🗄️  数据库总帖子数: {total_in_db}")
            if hasattr(self, 'target_posts'):
                completion = min(100, (self.scraped_count / self.target_posts) * 100)
                print(f"   🎯 目标完成度: {self.scraped_count}/{self.target_posts} ({completion:.1f}%)")
        except Exception as e:
            print(f"   ⚠️ 无法获取数据库统计: {e}")

        # 热门帖子统计
        if scraped_posts:
            top_post = max(scraped_posts, key=lambda x: x['score'])
            most_commented = max(scraped_posts, key=lambda x: len(x['comments']))

            print(f"\n🏆 本次爬取亮点:")
            print(f"   📈 最高分帖子: {top_post['title'][:40]}... (分数: {top_post['score']})")
            print(f"   💬 最多评论帖子: {most_commented['title'][:40]}... (评论: {len(most_commented['comments'])})")

        print("\n🔗 可在Supabase Web界面查看和查询所有数据")
        print("=" * 60)

    def run_scraping_session(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Core scraping function for integration with reddit_system.py

        Args:
            config: Configuration dictionary with keys:
                - max_posts: Maximum number of posts to scrape
                - strategy: Scraping strategy ('super_full', 'super_recent', etc.)
                - save_json: Whether to save JSON files (default: False)
                - mode: 'incremental' or 'fresh'

        Returns:
            Dict with detailed results
        """
        try:
            # Extract configuration
            max_posts = config.get('max_posts', 500)
            strategy = config.get('strategy', 'super_full')
            save_json = config.get('save_json', False)
            mode = config.get('mode', 'incremental')
            subreddit = config.get('subreddit', 'UofT')

            # Determine if super mode should be used
            super_mode = max_posts > 2000 or strategy.startswith('super_')

            print(f"📊 配置: {max_posts} 帖子, {'超级模式' if super_mode else '普通模式'}, 策略: {strategy}")

            # Initialize counters
            initial_count = self.get_database_post_count()

            # Run the core scraping logic using the existing run_enhanced_scraping method
            # Note: We need to ensure the instance uses the correct subreddit
            # Since we are inside the instance method, we assume self was initialized correctly
            # But run_scraping_session is often called on a fresh instance or via module function
            # If this instance was initialized with default 'UofT', we might need to re-init or just use it
            
            # Actually, the module-level function creates the instance.
            # We should update the module-level function to pass the subreddit.
            scraping_result = self.run_enhanced_scraping(
                max_posts=max_posts, 
                sort_type=strategy, 
                save_json=save_json,
                progress_callback=config.get('progress_callback')
            )

            # Calculate results from database count
            final_count = self.get_database_post_count()
            scraped_count = final_count - initial_count
            
            # Extract scraped posts and output dir
            scraped_posts = []
            output_dir = None
            if isinstance(scraping_result, dict):
                scraped_posts = scraping_result.get('scraped_posts', [])
                output_dir = scraping_result.get('output_dir')
            
            # Generate summary Markdown file
            file_path = None
            if scraped_posts:
                # If no output_dir (save_json=False), create a default one
                if not output_dir:
                    script_dir = os.path.dirname(os.path.abspath(__file__))
                    project_root = os.path.dirname(os.path.dirname(script_dir))
                    output_dir = os.path.join(project_root, 'output', 'reddit', 'latest')
                    os.makedirs(output_dir, exist_ok=True)
                
                file_path = os.path.join(output_dir, "index.md")
                try:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(f"# Reddit Scrape Results: r/{subreddit}\n\n")
                        f.write(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                        f.write(f"**Strategy:** {strategy}\n")
                        f.write(f"**Posts Scraped:** {len(scraped_posts)}\n\n")
                        
                        for i, post in enumerate(scraped_posts, 1):
                            f.write(f"## {i}. {post.get('title', 'Untitled')}\n\n")
                            f.write(f"**Author:** u/{post.get('author', 'unknown')} | **Score:** {post.get('score', 0)}\n")
                            f.write(f"**URL:** {post.get('url', '')}\n\n")
                            if post.get('selftext'):
                                summary = post['selftext'][:200].replace('\n', ' ') + "..." if len(post['selftext']) > 200 else post['selftext']
                                f.write(f"{summary}\n\n")
                            f.write("---\n\n")
                    print(f"📄 Generated summary markdown: {file_path}")
                except Exception as e:
                    print(f"⚠️ Failed to generate markdown summary: {e}")

            return {
                'status': 'success',
                'scraped_count': scraped_count,
                'total_posts_in_db': final_count,
                'strategy_used': strategy,
                'super_mode': super_mode,
                'file_path': file_path,
                'message': f'Successfully scraped {scraped_count} new posts using {strategy} strategy'
            }

        except Exception as e:
            # Get current count for partial success reporting
            try:
                current_count = self.get_database_post_count()
                initial_count = getattr(self, '_initial_count', current_count)
                scraped_count = current_count - initial_count
            except:
                scraped_count = 0

            return {
                'status': 'error',
                'scraped_count': scraped_count,
                'message': f'Scraping failed: {str(e)}'
            }


# Module-level convenience function for easy integration
def run_scraping_session(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convenience function to run a scraping session without creating an instance

    Args:
        config: Configuration dictionary

    Returns:
        Dict with scraping results
    """
    subreddit = config.get('subreddit', 'UofT')
    scraper = EnhancedUofTScraper(target_subreddit=subreddit)
    return scraper.run_scraping_session(config)


if __name__ == "__main__":
    print("🤖 增强版UofT Reddit爬虫")
    print("支持大规模爬取、自动去重、状态记录")
    print("=" * 60)

    # 用户配置
    try:
        max_posts = int(input("请输入要爬取的最大帖子数 (默认500): ") or "500")

        # 检查是否需要超级模式 - 默认启用超级模式
        if max_posts > 2000:
            super_mode = input(f"🚀 检测到大量需求({max_posts}个)，是否启用超级模式? (y/n, 默认y): ").lower().strip()
            super_mode = super_mode != 'n'  # 默认启用
        else:
            super_mode = input("🚀 是否启用超级模式突破API限制? (y/n, 默认y): ").lower().strip()
            super_mode = super_mode != 'n'  # 默认启用超级模式

        if not super_mode:
            # 普通模式：让用户选择排序方式
            sort_type = input("排序方式 (hot/new/best/top/rising, 默认new): ").strip() or "new"
        else:
            # 超级模式：让用户选择重点策略
            print("\n🎯 超级模式策略选择:")
            print("1. 全面模式 - 使用所有策略 (推荐)")
            print("2. 时效优先 - 重点获取最新帖子")
            print("3. 热门优先 - 重点获取高分帖子")
            print("4. 搜索优先 - 重点使用关键词搜索")

            strategy_choice = input("请选择策略 (1-4, 默认1-全面模式): ").strip() or "1"
            strategy_map = {
                "1": "super_full",
                "2": "super_recent",
                "3": "super_popular",
                "4": "super_search"
            }
            sort_type = strategy_map.get(strategy_choice, "super_full")

        save_json = input("是否同时保存JSON文件? (y/n, 默认n): ").lower().strip() == 'y'
        fast_mode = True  # 默认启用快速模式，不再询问

        # 显示配置信息
        if super_mode:
            strategy_names = {
                "super_full": "全面模式",
                "super_recent": "时效优先",
                "super_popular": "热门优先",
                "super_search": "搜索优先"
            }
            mode_desc = f"超级模式-{strategy_names.get(sort_type, '全面模式')}"
        else:
            mode_desc = f"{sort_type}排序"

        print(f"\n🎯 配置: 最多{max_posts}个帖子, {mode_desc}, JSON保存: {'是' if save_json else '否'}, 快速模式: 已启用 ⚡")

        if super_mode:
            strategy_descriptions = {
                "super_full": [
                    "🚀 PRAW官方API增强获取 (突破JSON API限制)",
                    "📊 所有时间范围的top排序 (day/week/month/year/all)",
                    "🔄 所有排序方式 (hot/new/rising/best)",
                    "🏛️ 深度历史挖掘 (controversial/gilded等特殊排序)",
                    "🔍 高级组合搜索 (30+个复杂查询组合)",
                    "🎯 智能关键词搜索 (50+个专业关键词，智能去重)"
                ],
                "super_recent": [
                    "⏰ 重点获取最新帖子 (day/week/month/year top排序)",
                    "🆕 优先使用new和rising排序",
                    "🏛️ 深度历史挖掘 (避免重复策略)",
                    "🔍 智能关键词搜索 (50+个UofT专业关键词)"
                ],
                "super_popular": [
                    "🔥 重点获取热门帖子 (hot/best排序优先)",
                    "📊 全时间范围top排序 (all/year/month)",
                    "📚 深度分页获取高分帖子",
                    "🔍 关键词搜索补充"
                ],
                "super_search": [
                    "🔍 优先使用关键词搜索 (25个UofT关键词)",
                    "📊 中期时间范围top排序 (month/year)",
                    "🔄 基础排序方式 (hot/new)",
                    "📚 深度分页补充"
                ]
            }

            print(f"🚀 {strategy_names.get(sort_type, '全面模式')}将使用以下策略:")
            for desc in strategy_descriptions.get(sort_type, strategy_descriptions["super_full"]):
                print(f"   {desc}")

        print("=" * 60)

        # 创建爬虫实例并运行
        scraper = EnhancedUofTScraper()
        # 快速模式默认启用 - 配置智能速率控制器
        scraper.rate_controller.base_delay = 1.0
        scraper.rate_controller.current_delay = 1.0
        print("⚡ 快速模式已自动启用：延迟减少到1秒，速度提升2倍！")
        scraper.run_enhanced_scraping(max_posts, sort_type, save_json)

    except KeyboardInterrupt:
        print("\n\n⏹️ 用户中断爬取")
    except Exception as e:
        print(f"\n❌ 程序错误: {e}")
        sys.exit(1)
