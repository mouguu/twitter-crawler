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

from scraper import scrape_reddit
from post_scraper import RedditPostScraper
from output_paths import resolve_output_dir

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
def scrape_subreddit():
    """爬取 subreddit (流式响应)"""
    data = request.get_json()
    
    subreddit = data.get('subreddit')
    if not subreddit:
        return jsonify({'error': 'Missing required parameter: subreddit'}), 400
    max_posts = data.get('max_posts', 100)
    strategy = data.get('strategy', 'auto')
    save_json = data.get('save_json', False)
    
    # Map 'auto' strategy
    if strategy == 'auto':
        if max_posts > 2000:
            strategy = 'super_full'
        else:
            strategy = 'new'
            
    def generate():
        import threading
        import queue
        
        # Queue for communicating between threads
        msg_queue = queue.Queue()
        
        def progress_callback(current, total, message):
            msg_queue.put({
                'type': 'progress',
                'current': current,
                'total': total,
                'message': message
            })
            
        def log_callback(message, level='info'):
            msg_queue.put({
                'type': 'log',
                'message': message,
                'level': level
            })

        def run_scraper():
            try:
                result = scrape_reddit(
                    target=f"r/{subreddit}",
                    max_posts=max_posts,
                    sort_type=strategy,
                    progress_callback=progress_callback,
                    log_callback=log_callback
                )
                msg_queue.put({
                    'type': 'result',
                    'success': result.get('status') == 'success',
                    'data': result,
                    'message': result.get('message', 'Scraping completed')
                })
            except Exception as e:
                msg_queue.put({
                    'type': 'error',
                    'success': False,
                    'error': str(e),
                    'error_type': type(e).__name__,
                    'traceback': traceback.format_exc()
                })
            finally:
                msg_queue.put(None) # Signal end
        
        # Start scraper in a separate thread
        thread = threading.Thread(target=run_scraper)
        thread.start()
        
        # Yield messages from queue
        while True:
            msg = msg_queue.get()
            if msg is None:
                break
            yield json.dumps(msg) + '\n'
            
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
            # 统一输出目录（支持 REDDIT_OUTPUT_DIR 环境变量）
            output_dir = resolve_output_dir()
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
    host = os.environ.get('REDDIT_API_HOST', '0.0.0.0')  # bind all interfaces for container access
    
    print(f"🚀 Starting Reddit API Server on {host}:{port}")
    app.run(host=host, port=port, debug=False)
