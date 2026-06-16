import { useState, useRef, useEffect, useCallback } from 'react';
import { useLogs, useLogInfo, useExportLogs } from '../hooks/useApi';
import s from '../styles/modules/Logs.module.css';

const LOG_TYPES = [
  { key: 'server', label: '标准日志' },
  { key: 'server_err', label: '错误日志' },
] as const;

function classifyLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('exception') || lower.includes('traceback')) return 'error';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('info')) return 'info';
  return '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Logs() {
  const [logType, setLogType] = useState('server');
  const [displayLines, setDisplayLines] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const { data, isFetching } = useLogs(logType);
  const { data: logInfo } = useLogInfo();
  const exportMut = useExportLogs();

  useEffect(() => {
    if (data?.lines) {
      setDisplayLines(data.lines);
    }
  }, [data]);

  useEffect(() => {
    if (shouldAutoScroll.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [displayLines]);

  const handleScroll = useCallback(() => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const handleClear = useCallback(() => {
    setDisplayLines([]);
  }, []);

  const handleExport = useCallback(() => {
    exportMut.mutate(logType, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${logType}.log`;
        a.click();
        URL.revokeObjectURL(url);
      },
    });
  }, [logType, exportMut]);

  const info = logInfo?.[logType];

  return (
    <>
      <div className="page-header">
        <h2>系统日志</h2>
        <small>查看和导出后端服务运行日志</small>
      </div>

      <div className={s.container}>
        <div className={s.toolbar}>
          <div className={s.tabs}>
            {LOG_TYPES.map((t) => (
              <button
                key={t.key}
                className={`${s.tab} ${logType === t.key ? s.active : ''}`}
                onClick={() => { setLogType(t.key); }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {info && info.exists && (
            <div className={s.logInfo}>
              <span>大小: {formatSize(info.size)}</span>
              {info.modified && <span>更新: {new Date(info.modified).toLocaleString('zh-CN')}</span>}
            </div>
          )}

          <div className={s.actions}>
            {isFetching && <span style={{ fontSize: 12, color: 'var(--brand-text-muted)' }}>刷新中...</span>}
            <button className={s.btn} onClick={handleClear}>清空</button>
            <button className={s.btn} onClick={handleExport} disabled={exportMut.isPending}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 5v10" />
                <path d="M6 11l4 4 4-4" />
                <path d="M4 3h12" />
              </svg>
              导出
            </button>
          </div>
        </div>

        <div className={s.logContainer} ref={logRef} onScroll={handleScroll}>
          {displayLines.length === 0 ? (
            <div className={s.empty}>暂无日志数据</div>
          ) : (
            displayLines.map((line, i) => (
              <div key={`${i}-${line.slice(0, 20)}`} className={`${s.logLine} ${classifyLine(line) ? s[classifyLine(line)] : ''}`}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
