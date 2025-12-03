"""
Smart Rate Controller for Reddit API

Manages request rate limiting with intelligent backoff strategies.
"""

import time
import random


class SmartRateController:
    """智能速率控制器 - 统一管理所有反爬策略"""
    
    def __init__(self):
        self.base_delay = 2.5  # 增加基础延迟以避免限流
        self.current_delay = 2.5
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

        # 连续成功时逐渐减少延迟 - 更保守的阈值
        if self.success_streak > 20 and self.current_delay > 1.5:
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
        return max(1.5, self.current_delay)  # 提高最小延迟

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
