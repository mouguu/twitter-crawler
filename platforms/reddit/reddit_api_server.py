#!/usr/bin/env python3
"""
Reddit API Server
提供 HTTP API 接口，替代 spawn 子进程通信方式
"""

from flask import Flask, request, jsonify, stream_with_context, Response
from flask_cors import CORS
import sys
import os
import json
import traceback

# 添加当前目录到路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from enhanced_scraper import run_scraping_session
from post_scraper import RedditPostScraper

app = Flask(__name__)
CORS(app)  # 允许跨域请求

@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'service': 'reddit-api-server',
        'version': '1.0.0'
    })

@app.route('/api/scrape/subreddit', methods=['POST'])
@app.route('/api/scrape/subreddit', methods=['POST'])
def scrape_subreddit():
    """爬取 subreddit (流式响应)"""
    data = request.get_json() or {}
    
    subreddit = data.get('subreddit', 'UofT')
    max_posts = data.get('max_posts', 100)
    strategy = data.get('strategy', 'auto')
    save_json = data.get('save_json', False)
    
    # 自动选择策略
    if strategy == 'auto':
        if max_posts > 5000:
            strategy = 'super_full'
        elif max_posts > 2000:
            strategy = 'super_recent'
        else:
            strategy = 'new'
    
    def generate():
        try:
            # 进度回调
            def progress_callback(current, total, message):
                progress_data = {
                    'type': 'progress',
                    'current': current,
                    'total': total,
                    'message': message
                }
                yield json.dumps(progress_data) + '\n'

            config = {
                'subreddit': subreddit,
                'max_posts': max_posts,
                'strategy': strategy,
                'save_json': save_json,
                'mode': 'incremental',
                'progress_callback': progress_callback
            }
            
            result = run_scraping_session(config)
            
            # 发送最终结果
            final_data = {
                'type': 'result',
                'success': result.get('status') == 'success',
                'data': result,
                'message': result.get('message', 'Scraping completed')
            }
            yield json.dumps(final_data) + '\n'
            
        except Exception as e:
            error_data = {
                'type': 'error',
                'success': False,
                'error': str(e),
                'error_type': type(e).__name__,
                'traceback': traceback.format_exc()
            }
            yield json.dumps(error_data) + '\n'

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson')

@app.route('/api/scrape/post', methods=['POST'])
def scrape_post():
    """爬取单个 Reddit 帖子"""
    try:
        data = request.get_json() or {}
        post_url = data.get('post_url')
        
        if not post_url:
            return jsonify({
                'success': False,
                'error': 'post_url is required'
            }), 400
        
        scraper = RedditPostScraper()
        result = scraper.scrape_post(post_url)
        
        if result.get('status') == 'success':
            # 获取项目根目录（reddit_api_server.py 在 platforms/reddit/ 目录下）
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(os.path.dirname(script_dir))
            
            # 保存到项目根目录的 output/reddit 目录
            output_dir = os.path.join(project_root, 'output', 'reddit')
            os.makedirs(output_dir, exist_ok=True)
            
            post_id = result['post']['id']
            
            # 保存 JSON 文件
            json_file = os.path.join(output_dir, f"reddit_post_{post_id}.json")
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            # 生成 Markdown 文件
            md_file = os.path.join(output_dir, f"reddit_post_{post_id}.md")
            with open(md_file, 'w', encoding='utf-8') as f:
                post = result['post']
                f.write(f"# {post.get('title', 'Untitled')}\n\n")
                f.write(f"**Subreddit:** r/{post.get('subreddit', 'unknown')}\n")
                f.write(f"**Author:** u/{post.get('author', 'unknown')}\n")
                f.write(f"**Score:** {post.get('score', 0)} | **Upvote Ratio:** {post.get('upvote_ratio', 0):.2%}\n")
                f.write(f"**Comments:** {result.get('comment_count', 0)}\n")
                f.write(f"**URL:** {post.get('permalink', '')}\n\n")
                
                if post.get('selftext'):
                    f.write("## Post Content\n\n")
                    f.write(f"{post['selftext']}\n\n")
                
                if result.get('comments'):
                    f.write("## Comments\n\n")
                    for i, comment in enumerate(result['comments'], 1):
                        indent = "  " * comment.get('depth', 0)
                        f.write(f"{indent}### Comment {i}\n\n")
                        f.write(f"{indent}**Author:** u/{comment.get('author', 'unknown')}\n")
                        f.write(f"{indent}**Score:** {comment.get('score', 0)}\n")
                        f.write(f"{indent}**Body:**\n\n{indent}{comment.get('body', '').replace(chr(10), chr(10) + indent)}\n\n")
            
            return jsonify({
                'success': True,
                'data': {
                    'post': result['post'],
                    'comments': result['comments'],
                    'comment_count': result['comment_count'],
                    'file_path': md_file  # 返回 markdown 文件路径
                },
                'message': f"Successfully scraped post with {result['comment_count']} comments"
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('message', 'Unknown error')
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }), 500

@app.route('/api/status', methods=['GET'])
def status():
    """获取服务状态"""
    return jsonify({
        'status': 'running',
        'service': 'reddit-api-server',
        'endpoints': [
            '/api/scrape/subreddit',
            '/api/scrape/post',
            '/health'
        ]
    })

if __name__ == '__main__':
    port = int(os.environ.get('REDDIT_API_PORT', 5002))
    host = os.environ.get('REDDIT_API_HOST', '127.0.0.1')
    
    print(f"🚀 Starting Reddit API Server on {host}:{port}")
    app.run(host=host, port=port, debug=False)

