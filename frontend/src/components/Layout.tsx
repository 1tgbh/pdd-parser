import { NavLink, Outlet } from 'react-router-dom';
import { useCaptureToggle, useSetCaptureToggle } from '../hooks/useApi';
import s from '../styles/modules/Layout.module.css';

const NAV_ITEMS = [
  {
    to: '/',
    label: '数据概览',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x={3} y={3} width={7} height={7} rx={1} />
        <rect x={14} y={3} width={7} height={7} rx={1} />
        <rect x={3} y={14} width={7} height={7} rx={1} />
        <rect x={14} y={14} width={7} height={7} rx={1} />
      </svg>
    ),
  },
  {
    to: '/products',
    label: '商品列表',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    to: '/compare',
    label: '商品对比',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x={3} y={3} width={7} height={18} rx={1} />
        <rect x={14} y={3} width={7} height={18} rx={1} />
      </svg>
    ),
  },
  {
    to: '/export',
    label: '数据导出',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1={12} y1={15} x2={12} y2={3} />
      </svg>
    ),
  },
  {
    to: '/import',
    label: '数据导入',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1={12} y1={3} x2={12} y2={15} />
      </svg>
    ),
  },
  {
    to: '/ai-editor',
    label: 'AI 编辑',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x={3} y={3} width={18} height={18} rx={2} />
        <circle cx={8.5} cy={8.5} r={1.5} />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
  {
    to: '/ai-copywriting',
    label: 'AI 文案',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    to: '/monitor',
    label: '商品监控',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx={12} cy={12} r={3} />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: '设置',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <circle cx={12} cy={12} r={3} />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },];

/** 主布局：侧边栏 + 内容区 */
function CaptureToggle() {
  const { data } = useCaptureToggle();
  const toggleMut = useSetCaptureToggle();
  const enabled = data?.enabled ?? true;
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 13, userSelect: 'none' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: enabled ? '#22c55e' : '#9ca3af', display: 'inline-block' }} />
        采集开关
      </span>
      <button
        onClick={() => toggleMut.mutate(!enabled)}
        style={{
          position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', padding: 0,
          background: enabled ? '#22c55e' : '#d1d5db', transition: 'background 0.2s',
        }}
        aria-label={enabled ? '关闭采集' : '开启采集'}
      >
        <span style={{
          position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </label>
  );
}

/** 主布局：侧边栏 + 内容区 */
export default function Layout() {
  return (
    <div className={s.layout}>
      <aside className={s.sidebar} role="navigation" aria-label="主导航">
        <div className={s.logo}>
          <img src="/logo.svg" alt="多多采集" style={{ width: '100%', maxWidth: 160, height: 'auto' }} />
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
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-200, #e5e7eb)' }}>
          <CaptureToggle />
        </div>
        <div className={s.footer}>v2.0 · AI 增强版</div>
      </aside>
      <main className={s.main} role="main">
        <Outlet />
      </main>
    </div>
  );
}


