import React, { createContext, useContext, useState, useCallback, ReactNode, Suspense, lazy } from 'react';

import type { Toast, ToastVariant } from '../components/ToastViewport';

// Loaded on the first toast, not at boot — see components/ToastViewport.tsx.
const ToastViewport = lazy(() => import('../components/ToastViewport'));

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
        {toasts.length > 0 && (
          <Suspense fallback={null}>
            <ToastViewport toasts={toasts} onDismiss={removeToast} />
          </Suspense>
        )}
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
