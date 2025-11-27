// Error categories for UI styling
const ERROR_CATEGORIES = {
    network: {
        icon: '📡',
        color: 'text-blue-700',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200'
    },
    auth: {
        icon: '🔐',
        color: 'text-red-700',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200'
    },
    rate_limit: {
        icon: '⏱️',
        color: 'text-yellow-700',
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200'
    },
    config: {
        icon: '⚙️',
        color: 'text-purple-700',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200'
    },
    validation: {
        icon: '⚠️',
        color: 'text-orange-700',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200'
    },
    unknown: {
        icon: '❌',
        color: 'text-gray-700',
        bgColor: 'bg-gray-50',
        borderColor: 'border-gray-200'
    }
};

interface ErrorNotificationProps {
    error: any; // AppError type
    onDismiss: () => void;
    onRetry?: () => void;
}

export function ErrorNotification({ error, onDismiss, onRetry }: ErrorNotificationProps) {
    const category = ERROR_CATEGORIES[error.type as keyof typeof ERROR_CATEGORIES] || ERROR_CATEGORIES.unknown;

    return (
        <div className={`p-4 border-l-4 rounded-r shadow-md mb-4 ${category.bgColor} ${category.borderColor}`}>
            <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{category.icon}</span>
                
                <div className="flex-1 min-w-0">
                    <h4 className={`font-semibold font-serif ${category.color}`}>
                        {error.message}
                    </h4>
                    
                    {error.suggestion && (
                        <p className="text-sm text-stone-600 mt-2 whitespace-pre-line">
                            💡 {error.suggestion}
                        </p>
                    )}
                    
                    {error.details && (
                        <details className="text-xs text-stone-500 mt-2">
                            <summary className="cursor-pointer hover:text-stone-700">
                                技术详情
                            </summary>
                            <pre className="mt-2 p-2 bg-white/50 rounded text-xs overflow-x-auto">
                                {error.details}
                            </pre>
                        </details>
                    )}
                    
                    <div className="text-[10px] text-stone-400 mt-2">
                        {error.timestamp?.toString()}
                    </div>
                </div>
                
                <div className="flex gap-2 flex-shrink-0">
                    {error.canRetry && onRetry && (
                        <button
                            onClick={onRetry}
                            className="px-3 py-1 text-sm bg-rust text-white rounded hover:bg-rust/90 transition-colors"
                        >
                            重试
                        </button>
                    )}
                    <button
                        onClick={onDismiss}
                        className="text-stone-600 hover:text-stone-900 transition-colors p-1"
                        aria-label="关闭"
                    >
                        ✕
                    </button>
                </div>
            </div>
        </div>
    );
}
