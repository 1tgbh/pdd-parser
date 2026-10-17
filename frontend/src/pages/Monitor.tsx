import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMonitorList, useAddMonitor, useRemoveMonitor, useRefreshMonitor, useMonitorHistory } from '../hooks/useApi';
import { useSearchProductsForEditor } from '../hooks/useApi';
import { updateMonitorFrequency } from '../api';
import type { MonitorItem, MonitorHistoryPoint } from '../types';
import s from '../styles/modules/Monitor.module.css';

const FREQ_MAP: Record<string, string> = { daily: '每天', '12h': '12小时', '6h': '6小时' };

function formatTime(t: string | null) {
  if (!t) return '—';
  return t.slice(0, 16).replace('T', ' ');
}

function ChangeIndicator({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className={s.changeFlat}>—</span>;
  if (value > 0) return <span className={s.changeUp}>↑ +{value}{suffix}</span>;
  if (value < 0) return <span className={s.changeDown}>↓ {value}{suffix}</span>;
  return <span className={s.changeFlat}>— 0{suffix}</span>;
}

function MiniSvgChart({ points, label }: { points: MonitorHistoryPoint[]; label: string }) {
  const values = useMemo(() => points.map(p => {
    if (label === 'price') return p.price ?? 0;
    if (label === 'sales') return p.sales ?? 0;
    return p.stock ?? 0;
  }), [points, label]);

  if (values.length < 2) return <div className={s.chartContainer}><div className={s.chartTitle}>{label === 'price' ? '价格趋势' : label === 'sales' ? '销量趋势' : '库存趋势'}（数据不足）</div></div>;

  const reversed = [...values].reverse();
  const w = 480, h = 80, pad = 4;
  const min = Math.min(...reversed);
  const max = Math.max(...reversed);
  const range = max - min || 1;
  const step = (w - pad * 2) / (reversed.length - 1);
  const pts = reversed.map((v, i) => `${pad + i * step},${pad + (1 - (v - min) / range) * (h - pad * 2)}`).join(' ');

  return (
    <div className={s.chartContainer}>
      <div className={s.chartTitle}>{label === 'price' ? '价格趋势' : label === 'sales' ? '销量趋势' : '库存趋势'}</div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h }}>
        <polyline points={pts} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" />
        {reversed.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={pad + (1 - (v - min) / range) * (h - pad * 2)} r="3" fill="#f97316" />
        ))}
      </svg>
    </div>
  );
}

function HistoryModal({ item, onClose }: { item: MonitorItem; onClose: () => void }) {
  const { data: history = [], isLoading } = useMonitorHistory(item.goods_id);
  const reversed = useMemo(() => [...history].reverse(), [history]);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <div className={s.modalTitle}>监控历史 — {item.title.slice(0, 30)}</div>
          <button className={s.modalClose} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={s.modalBody}>
          {isLoading ? (
            <div className={s.loadingWrap}>加载中...</div>
          ) : history.length === 0 ? (
            <div className={s.loadingWrap}>暂无历史数据</div>
          ) : (
            <>
              <MiniSvgChart points={reversed} label="price" />
              <MiniSvgChart points={reversed} label="sales" />
              <div className={s.timeline}>
                <div className={s.timelineTitle}>数据记录</div>
                <div className={s.timelineItem} style={{ background: 'var(--blue-50)', fontWeight: 600, color: 'var(--gray-500)' }}>
                  <span>时间</span><span>价格</span><span>库存</span><span>销量</span>
                </div>
                {reversed.map((p, i) => (
                  <div className={s.timelineItem} key={i}>
                    <span className={s.timelineTime}>{formatTime(p.checked_at)}</span>
                    <span>{p.price !== null ? `¥${p.price}` : '—'}</span>
                    <span>{p.stock !== null ? p.stock : '—'}</span>
                    <span>{p.sales !== null ? p.sales : '—'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState('daily');
  const { data: searchResult } = useSearchProductsForEditor(keyword);
  const addMonitor = useAddMonitor();

  const items = searchResult?.items || [];

  const handleAdd = async () => {
    if (!selectedId) return;
    await addMonitor.mutateAsync({ goodsId: selectedId, frequency });
    onClose();
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <div className={s.modalTitle}>添加监控商品</div>
          <button className={s.modalClose} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={s.modalBody}>
          <div className={s.addSearchWrapper}>
            <input
              className={s.searchInput}
              placeholder="搜索商品标题或ID…"
              value={keyword}
              onChange={e => { setKeyword(e.target.value); setSelectedId(null); }}
              aria-label="搜索监控商品"
            />
            {keyword && !selectedId && items.length > 0 && (
              <div className={s.addSearchDropdown}>
                {items.slice(0, 8).map(item => (
                  <div
                    key={item.goods_id}
                    className={s.dropdownItem}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setSelectedId(item.goods_id); setKeyword(item.title); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setSelectedId(item.goods_id); setKeyword(item.title); } }}
                  >
                    {item.main_images[0] && <img src={item.main_images[0]} className={s.dropdownThumb} alt="" />}
                    <span className={s.dropdownTitle}>{item.title || item.goods_id}</span>
                  </div>
                ))}
              </div>
            )}
            {keyword && !selectedId && items.length === 0 && (
              <div className={s.addSearchDropdown}><div className={s.dropdownEmpty}>无搜索结果</div></div>
            )}
          </div>
          <div className={s.freqGroup}>
            {Object.entries(FREQ_MAP).map(([k, v]) => (
              <button
                key={k}
                className={`${s.freqOption} ${frequency === k ? s.freqOptionActive : ''}`}
                onClick={() => setFrequency(k)}
              >{v}</button>
            ))}
          </div>
        </div>
        <div className={s.modalFooter}>
          <button className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>取消</button>
          <button
            className={`${s.btn} ${s.btnPrimary}`}
            disabled={!selectedId || addMonitor.isPending}
            onClick={handleAdd}
          >{addMonitor.isPending ? '添加中...' : '添加监控'}</button>
        </div>
      </div>
    </div>
  );
}

function MonitorCard({ item }: { item: MonitorItem }) {
  const removeMonitor = useRemoveMonitor();
  const queryClient = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);

  const handleFreqChange = async (freq: string) => {
    await updateMonitorFrequency(item.goods_id, freq);
    queryClient.invalidateQueries({ queryKey: ['monitorList'] });
  };

  return (
    <>
      <div className={s.monitorCard}>
        <div className={s.monitorCardTop}>
          {item.main_images[0] ? (
            <img src={item.main_images[0]} alt="" className={s.monitorThumb} />
          ) : (
            <div className={s.monitorThumb} />
          )}
          <div className={s.monitorInfo}>
            <div className={s.monitorTitle}>{item.title || '未知商品'}</div>
            <div className={s.monitorGoodsId}>ID: {item.goods_id}</div>
          </div>
        </div>

        <div className={s.monitorMetrics}>
          <div className={s.metricCell}>
            <div className={s.metricLabel}>价格</div>
            <div className={s.metricValue}>{item.latest_price !== null ? `¥${item.latest_price}` : '—'}</div>
            <div className={s.metricChange}><ChangeIndicator value={item.price_change} /></div>
          </div>
          <div className={s.metricCell}>
            <div className={s.metricLabel}>库存</div>
            <div className={s.metricValue} style={{ color: item.latest_stock != null && item.latest_stock > 0 ? '#16a34a' : item.latest_stock === 0 ? '#dc2626' : undefined }}>
              {item.latest_stock != null && item.latest_stock > 0 ? item.latest_stock.toLocaleString() : '-'}
            </div>
            {item.stock_change != null && item.stock_change !== 0 && (
              <div className={`${s.metricChange} ${item.stock_change > 0 ? s.changeUp : s.changeDown}`}>
                {item.stock_change > 0 ? '+' : ''}{item.stock_change}
              </div>
            )}
          </div>
          <div className={s.metricCell}>
            <div className={s.metricLabel}>销量</div>
            <div className={s.metricValue}>{item.latest_sales ?? '—'}</div>
            <div className={s.metricChange}><ChangeIndicator value={item.sales_change} /></div>
          </div>
        </div>

        {item.last_check && (
          <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
            上次检查: {item.last_check}
          </div>
        )}

        <div className={s.monitorCardBottom}>
          <select
            className={s.freqSelect}
            defaultValue={item.frequency}
            onChange={e => handleFreqChange(e.target.value)}
            aria-label="监控频率"
          >
            <option value="daily">每天</option>
            <option value="12h">12小时</option>
            <option value="6h">6小时</option>
          </select>
          <div className={s.bottomActions}>
            <button className={`${s.btn} ${s.btnGhost}`} onClick={() => setShowHistory(true)}>查看详情</button>
            <button
              className={`${s.btn} ${s.btnDanger}`}
              disabled={removeMonitor.isPending}
              onClick={() => removeMonitor.mutate(item.goods_id)}
            >移除</button>
          </div>
        </div>
      </div>
      {showHistory && <HistoryModal item={item} onClose={() => setShowHistory(false)} />}
    </>
  );
}

export default function Monitor() {
  const { data: monitorList = [], isLoading } = useMonitorList();
  const refreshMut = useRefreshMonitor();
  const [showAdd, setShowAdd] = useState(false);

  const stats = useMemo(() => {
    const total = monitorList.length;
    const priceDrops = monitorList.filter(m => m.price_change !== null && m.price_change! < 0).length;
    const stockAlerts = monitorList.filter(m => m.latest_stock !== null && m.latest_stock < 10).length;
    return { total, priceDrops, stockAlerts };
  }, [monitorList]);

  return (
    <div className={s.container}>
      <div className={s.header}>
        <h1 className={s.headerTitle}>商品监控</h1>
        <div className={s.headerActions}>
          <button
            className={`${s.btn} ${s.btnPrimary}`}
            disabled={refreshMut.isPending}
            onClick={() => refreshMut.mutate()}
          >
            {refreshMut.isPending ? '刷新中…' : '⟳ 立即刷新'}
          </button>
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => setShowAdd(true)}>+ 添加商品</button>
        </div>
      </div>

      <div className={s.statsRow}>
        <div className={s.statCard}>
          <div className={`${s.statIcon} ${s.statIconBlue}`}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
              <path d="M10 2L3 6v8l7 4 7-4V6l-7-4z"/>
              <path d="M3 6l7 4 7-4"/>
              <path d="M10 10v8"/>
            </svg>
          </div>
          <div>
            <div className={s.statLabel}>监控商品</div>
            <div className={s.statValue}>{stats.total}</div>
          </div>
        </div>
        <div className={s.statCard}>
          <div className={`${s.statIcon} ${s.statIconGreen}`}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
              <polyline points="3,5 8,10 12,8 17,14"/>
              <polyline points="13,14 17,14 17,10"/>
            </svg>
          </div>
          <div>
            <div className={s.statLabel}>降价商品</div>
            <div className={s.statValue}>{stats.priceDrops}</div>
          </div>
        </div>
        <div className={s.statCard}>
          <div className={`${s.statIcon} ${s.statIconOrange}`}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:20,height:20}}>
              <path d="M10 3L2 17h16L10 3z"/>
              <line x1="10" y1="9" x2="10" y2="13"/>
              <circle cx="10" cy="15" r="0.7" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <div>
            <div className={s.statLabel}>库存预警</div>
            <div className={s.statValue}>{stats.stockAlerts}</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className={s.loadingWrap}>加载中...</div>
      ) : monitorList.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:28,height:28}}>
              <rect x="3" y="10" width="3" height="6" rx="0.5"/>
              <rect x="8.5" y="6" width="3" height="10" rx="0.5"/>
              <rect x="14" y="3" width="3" height="13" rx="0.5"/>
            </svg>
          </div>
          <div className={s.emptyText}>暂无监控商品，点击「添加商品」开始监控</div>
        </div>
      ) : (
        <div className={s.monitorGrid}>
          {monitorList.map(item => <MonitorCard key={item.goods_id} item={item} />)}
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
