#!/bin/bash
# Reddit API 服务器启动脚本 - 自动化设置和启动

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REDDIT_DIR="$SCRIPT_DIR/../platforms/reddit"
VENV_DIR="$REDDIT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python3"
VENV_PIP="$VENV_DIR/bin/pip"

cd "$REDDIT_DIR" || exit 1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Reddit API Server Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 检查 Python 是否安装
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    echo "   Please install Python 3: https://www.python.org/downloads/"
    exit 1
fi

echo "✓ Python 3 detected: $(python3 --version)"

# 2. 检查并创建虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo "📦 Creating Python virtual environment..."
    if ! python3 -m venv "$VENV_DIR"; then
        echo "❌ Failed to create virtual environment"
        exit 1
    fi
    echo "✓ Virtual environment created at: $VENV_DIR"
else
    echo "✓ Virtual environment exists"
fi

# 3. 检查并安装依赖
# 使用虚拟环境的 Python 来检查依赖
echo ""
echo "🔍 Checking dependencies..."

NEED_INSTALL=false
if ! "$VENV_PYTHON" -c "import flask" 2>/dev/null; then
    echo "⚠️  Flask not found"
    NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
    echo ""
    echo "📦 Installing Python dependencies..."
    echo "   This may take a minute..."
    
    # 使用虚拟环境的 pip 安装依赖
    if ! "$VENV_PIP" install -q -r requirements.txt; then
        echo "❌ Failed to install dependencies"
        echo "   Try manually: cd $REDDIT_DIR && .venv/bin/pip install -r requirements.txt"
        exit 1
    fi
    
    echo "✓ Dependencies installed successfully"
else
    echo "✓ All dependencies are installed"
fi

# 4. 启动服务器
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Starting Reddit API Server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   URL: http://127.0.0.1:5002"
echo "   Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 使用虚拟环境的 Python 运行服务器
exec "$VENV_PYTHON" reddit_api_server.py

