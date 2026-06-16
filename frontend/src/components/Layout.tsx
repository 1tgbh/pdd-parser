import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCaptureToggle, useSetCaptureToggle } from '../hooks/useApi';
import s from '../styles/modules/Layout.module.css';
import { useRiskCheck, useDismissRiskCheck, useSettings, useDeleteProducts } from '../hooks/useApi';

const NAV_ITEMS = [
  {
    to: '/',
    label: '数据概览',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="10" width="3" height="6" rx="0.5" />
        <rect x="8.5" y="6" width="3" height="10" rx="0.5" />
        <rect x="14" y="3" width="3" height="13" rx="0.5" />
      </svg>
    ),
  },
  {
    to: '/products',
    label: '商品列表',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="6" height="6" rx="1.5" />
        <rect x="11" y="3" width="6" height="6" rx="1.5" />
        <rect x="3" y="11" width="6" height="6" rx="1.5" />
        <rect x="11" y="11" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    to: '/compare',
    label: '对比分析',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10h12" />
        <path d="M12 6l4 4-4 4" />
        <circle cx="6" cy="10" r="2.5" />
        <circle cx="15" cy="10" r="1" />
      </svg>
    ),
  },
  {
    to: '/import',
    label: '数据导入',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 15V5" />
        <path d="M6 9l4-4 4 4" />
        <path d="M4 17h12" />
      </svg>
    ),
  },
  {
    to: '/export',
    label: '数据导出',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 5v10" />
        <path d="M6 11l4 4 4-4" />
        <path d="M4 3h12" />
      </svg>
    ),
  },
  {
    to: '/ai-editor',
    label: 'AI 编辑器',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 3.5l5 5-9 9H2.5v-5l9-9z" />
        <circle cx="14" cy="6" r="0.5" fill="currentColor" />
        <path d="M10 5l5 5" />
      </svg>
    ),
  },
  {
    to: '/ai-copywriting',
    label: 'AI 文案',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 17l2-6L14.5 2.5a1 1 0 011.4 0l1.6 1.6a1 1 0 010 1.4L9 15l-5 2z" />
        <line x1="12.5" y1="4.5" x2="15.5" y2="7.5" />
      </svg>
    ),
  },
  {
    to: '/monitor',
    label: '价格监控',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3,14 6,8 9,11 12,5 15,9 18,6" />
        <line x1="3" y1="17" x2="18" y2="17" />
      </svg>
    ),
  },
  {
    to: '/logs',
    label: '系统日志',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <path d="M7 8l3 3-3 3" />
        <line x1="11" y1="14" x2="14" y2="14" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'API 设置',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="2.5" />
        <path d="M10 2v1.5M10 16.5V18M18 10h-1.5M3.5 10H2M15.7 4.3l-1 1M5.3 14.7l-1 1M15.7 15.7l-1-1M5.3 5.3l-1-1" />
      </svg>
    ),
  },
];

function CaptureToggle() {
  const { data } = useCaptureToggle();
  const toggleMut = useSetCaptureToggle();
  const enabled = data?.enabled ?? true;
  return (
    <label className={s.toggleLabel}>
      <span className={s.toggleStatus}>
        <span className={s.toggleDot} style={{ background: enabled ? 'var(--brand-accent)' : 'var(--brand-gray-4)' }} />
        采集开关
      </span>
      <button
        className={s.toggleSwitch}
        onClick={() => toggleMut.mutate(!enabled)}
        style={{ background: enabled ? 'var(--brand-accent)' : 'var(--brand-gray-4)' }}
        aria-label={enabled ? '关闭采集' : '开启采集'}
      >
        <span className={s.toggleKnob} style={{ left: enabled ? 20 : 2 }} />
      </button>
    </label>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const riskEnabled = settings?.risk_monitor?.enabled ?? false;
  const riskInterval = settings?.risk_monitor?.interval ?? 30;
  const { data: riskData } = useRiskCheck(riskEnabled, riskInterval);
  const dismissMut = useDismissRiskCheck();
  const deleteMut = useDeleteProducts();
  const [riskDismissed, setRiskDismissed] = useState(false);

  const showRiskPopup = riskEnabled && !riskDismissed && riskData?.goods && riskData.goods.length > 0;

  const handleDeleteRiskGood = (goodsId: string) => {
    deleteMut.mutate([goodsId], {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['riskCheck'] }),
    });
  };

  const handleDismissAll = () => {
    dismissMut.mutate(undefined, { onSuccess: () => setRiskDismissed(true) });
  };

  return (
    <div className={s.layout}>
      <aside className={s.sidebar} role="navigation" aria-label="主导航">
        <div className={s.logo}>
          <h1>多多采集</h1>
          <small>AI 增强版 v1.1.2</small>
        </div>
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'active' : '')}
              aria-current={({ isActive }: { isActive: boolean }) => (isActive ? 'page' : undefined) as unknown as string}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={s.toggleWrap}>
          <CaptureToggle />
        </div>
        <div className={s.footer}>v1.1.2</div>
      </aside>
      <main className={s.main} role="main">
        <Outlet />
      </main>
      {showRiskPopup && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: '24px 32px',
            maxWidth: 520, width: '90%', maxHeight: '80vh',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ marginBottom: 8 }}>
                <path d="M22 4L4 38h36L22 4z" fill="#F59E0B" stroke="#D97706" strokeWidth="2" strokeLinejoin="round"/>
                <rect x="20" y="16" width="4" height="12" rx="2" fill="#fff"/>
                <circle cx="22" cy="32" r="2" fill="#fff"/>
              </svg>
              <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>账号风控提醒</h3>
              <p style={{ color: '#666', fontSize: 13, margin: 0 }}>
                检测到 <strong style={{ color: '#1d1d1f' }}>{riskData!.goods.length}</strong> 个商品缺少 SKU 信息
              </p>
            </div>
            <div style={{ flex: 1, overflow: 'auto', maxHeight: '50vh' }}>
              {riskData!.goods.map((item) => (
                <div key={item.goods_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0', borderBottom: '1px solid #f0f0f0',
                }}>
                  {item.image ? (
                    <img src={item.image} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 6, background: '#f5f5f5' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>¥{item.price}</div>
                  </div>
                  <button
                    onClick={() => handleDeleteRiskGood(item.goods_id)}
                    disabled={deleteMut.isPending}
                    style={{
                      padding: '4px 12px', borderRadius: 6, border: '1px solid #ddd',
                      background: '#fff', fontSize: 12, cursor: 'pointer', color: '#666', flexShrink: 0,
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                onClick={handleDismissAll}
                disabled={dismissMut.isPending}
                style={{
                  padding: '10px 32px', borderRadius: 8, border: 'none',
                  background: '#1d1d1f', color: '#fff', fontSize: 14,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                全部忽略
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
