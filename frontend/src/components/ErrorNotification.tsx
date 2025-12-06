import { motion } from 'framer-motion';
import { X, RefreshCw, AlertCircle, Wifi, Key, Clock, Settings, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ERROR_CATEGORIES = {
  network: {
    icon: Wifi,
    color: 'text-slate-600',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
  },
  auth: {
    icon: Key,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  rate_limit: {
    icon: Clock,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  config: {
    icon: Settings,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  validation: {
    icon: AlertTriangle,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
  unknown: {
    icon: AlertCircle,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
  },
};

interface ErrorNotificationProps {
  error: any;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ErrorNotification({ error, onDismiss, onRetry }: ErrorNotificationProps) {
  const category =
    ERROR_CATEGORIES[error.type as keyof typeof ERROR_CATEGORIES] || ERROR_CATEGORIES.unknown;
  const Icon = category.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={`
                relative overflow-hidden
                ${category.bgColor} ${category.borderColor}
                border rounded-2xl shadow-xl
                backdrop-blur-sm
            `}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div
            className={`flex-shrink-0 w-10 h-10 ${category.color} ${category.bgColor} flex items-center justify-center rounded-xl border ${category.borderColor}`}
          >
            <Icon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Title */}
            <h4 className={`font-medium ${category.color}`}>{error.message}</h4>

            {/* Suggestion */}
            {error.suggestion && (
              <div className="mt-2 p-2.5 rounded-lg bg-white/60 border border-white/80">
                <p className="text-sm text-muted-foreground">💡 {error.suggestion}</p>
              </div>
            )}

            {/* Details */}
            {error.details && (
              <details className="mt-3 text-xs text-muted-foreground group">
                <summary className="cursor-pointer hover:text-foreground transition-colors select-none">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block transition-transform group-open:rotate-90">
                      ▶
                    </span>
                    <span className="text-xs uppercase tracking-wider">Details</span>
                  </span>
                </summary>
                <pre className="mt-2 p-3 bg-white/80 rounded-lg text-xs overflow-x-auto font-mono text-foreground/70 border border-border/50">
                  {error.details}
                </pre>
              </details>
            )}

            {/* Timestamp */}
            <div className="mt-2 text-xs text-muted-foreground font-mono">
              {error.timestamp?.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {error.canRetry && onRetry && (
              <Button onClick={onRetry} size="sm" className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </Button>
            )}
            <Button onClick={onDismiss} variant="ghost" size="icon" className="w-8 h-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
