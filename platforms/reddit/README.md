# UofT Reddit Data System 🎯

A comprehensive, unified system for scraping, standardizing, and analyzing University of Toronto Reddit data. This system addresses the complex challenges of Reddit's nested data structure and provides high-quality, research-ready datasets.

## 🌟 Key Features

### 🔄 **Unified Data Pipeline**

- **Scraping**: Multi-strategy Reddit data collection
- **Standardization**: Automated content cleaning and normalization
- **Export**: High-quality CSV datasets with comprehensive metadata
- **Analysis**: Built-in data quality assessment

### 🧠 **Advanced Data Processing**

- **Comment Tree Flattening**: Converts Reddit's nested structure to analyzable format
- **Content Normalization**: Handles emojis, links, mentions, deleted content
- **Quality Scoring**: Automated assessment for dataset curation
- **Metadata Preservation**: Maintains original data alongside cleaned versions

### 🎯 **Research-Ready Output**

- **Standardized CSV Format**: Compatible with Excel, Python, R, etc.
- **Quality Metrics**: Built-in quality scores for each post and comment
- **Comprehensive Metadata**: Author info, timestamps, engagement metrics
- **Flexible Filtering**: Export by quality level, content type, etc.

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动系统

```bash
python3 reddit_system.py
```

### 3. 使用交互菜单

系统提供直观的交互界面：

```text
🚀 UofT Reddit System
==================================================
📊 University of Toronto Reddit Data System
🎯 Professional dataset creation and analysis
==================================================

Available Actions:
1. 🔄 Scrape new posts
2. 📊 Export professional CSV (Kaggle-ready)
3. 📋 Export standardized data (legacy)
4. 🔍 Analyze data quality
5. 📊 Show system status
6. ❌ Exit
```

## 文件说明

### 单个帖子文件结构

每个帖子JSON文件包含：

```json
{
  "id": "帖子ID",
  "title": "帖子标题",
  "author": "作者用户名",
  "score": 评分数,
  "selftext": "帖子正文内容",
  "url": "帖子链接",
  "created_utc": 创建时间戳,
  "num_comments": 评论总数,
  "comments": [
    {
      "id": "评论ID",
      "author": "评论作者",
      "body": "评论内容",
      "score": 评论评分,
      "replies": [嵌套回复...]
    }
  ]
}
```

### 统计报告 (00_REPORT_statistics.json)

包含：

- 基本统计信息（总帖子数、总评论数、平均评分）
- 按评分排序的热门帖子 Top 5
- 按评论数排序的热门帖子 Top 5

## 技术原理

使用Reddit的 `.json` API接口：

- 获取帖子列表: `https://www.reddit.com/r/UofT/hot.json`
- 获取帖子详情: `https://www.reddit.com/r/UofT/comments/[post_id]/[title].json`

这种方法：

- ✅ 简单稳定，无需模拟浏览器
- ✅ 获取完整数据，包括所有评论和回复
- ✅ 无需登录或API密钥
- ✅ 避开复杂的前端渲染和反爬机制

## 注意事项

1. **请求频率**: 内置1秒延迟，请勿修改为更高频率
2. **数据时效**: 抓取的是当前时刻的数据快照
3. **存储空间**: 50个帖子约占用几MB空间
4. **网络环境**: 需要能正常访问Reddit

## 自定义修改

如需修改抓取数量或其他参数，可编辑 `uoft_scraper.py` 中的相关设置：

```python
# 修改抓取数量（第155行附近）
post_urls = self.get_uoft_posts(50)  # 改为其他数字

# 修改请求延迟（第21行）
self.delay = 1.0  # 改为其他秒数
```

## 数据分析

可以使用 `analyze_data.py` 对抓取的数据进行进一步分析：

```bash
python3 analyze_data.py
```

## 许可证

本项目仅供学习和研究使用，请遵守Reddit的使用条款和robots.txt规则。
