import { useState, useCallback, useEffect, useMemo, createContext, useContext } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: () => Promise.resolve(false) });

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its provider
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, handleCancel]);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={handleCancel}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-icon">
              {state.options.danger ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="var(--brand-red)" strokeWidth="2"/><path d="M12 8v5M12 15.5v0" stroke="var(--brand-red)" strokeWidth="2" strokeLinecap="round"/></svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="var(--brand-blue)" strokeWidth="2"/><path d="M12 8v5M12 15.5v0" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round"/></svg>
              )}
            </div>
            <h3 className="confirm-title">{state.options.title}</h3>
            <p className="confirm-message">{state.options.message}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline btn-sm" onClick={handleCancel}>
                {state.options.cancelText || '取消'}
              </button>
              <button
                className={`btn btn-sm ${state.options.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleConfirm}
              >
                {state.options.confirmText || '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
