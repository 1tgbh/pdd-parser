import { useState, useCallback, useRef } from 'react';

/** 全局 Toast 提示 hook */
export function useToast() {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = useCallback((text: string, ms = 2500) => {
    clearTimeout(timer.current);
    setMsg(text);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), ms);
  }, []);

  return { msg, visible, showToast };
}
