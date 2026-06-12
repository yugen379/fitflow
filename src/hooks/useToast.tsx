import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextType {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-24 left-4 right-4 z-[9999] flex flex-col items-center gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = toast.variant === 'success' ? CheckCircle : toast.variant === 'error' ? AlertCircle : Info;
            const accentClass =
              toast.variant === 'success' ? 'text-accent border-accent/25'
              : toast.variant === 'error' ? 'text-accent-2 border-accent-2/25'
              : 'text-accent-3 border-accent-3/25';
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className={`pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-2xl border w-full max-w-sm glass ${accentClass}`}
              >
                <Icon size={16} />
                <p className="flex-1 text-sm font-medium text-white leading-snug">{toast.message}</p>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-text-dim hover:text-white transition-colors"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
