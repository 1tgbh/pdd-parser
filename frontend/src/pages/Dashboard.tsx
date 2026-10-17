import { useMemo } from 'react';
import { useDashboard, usePriceAlerts } from '../hooks/useApi';
import type { GoodsInfo } from '../types';
import s from '../styles/modules/Dashboard.module.css';

const STAT_CARDS = [
  { icon: 'blue', label: '商品总数', key: 'total_goods' as const },
  { icon: 'orange', label: '今日采集', key: 'today_goods' as const },
  { icon: 'green', label: '店铺数量', key: 'shop_count' as const },
] as const;

const SHOP_ICON_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);

export default function Dashboard() {
  const { data, isLoading } = useDashboard();
  const { data: alerts } = usePriceAlerts();

  const sortedShops = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.shop_distribution)
      .sort(([, a], [, b]) => (b as number) - (a as number));
  }, [data]);

  if (isLoading) return <Skeleton />;
  if (!data) return <div className="empty">暂无数据</div>;

  return (
    <>
      <div className="page-header">
        <h2>数据概览</h2>
        <small>实时统计</small>
      </div>

      {alerts && alerts.length > 0 && (
        <div className={s.fadeIn} style={{
          background: 'linear-gradient(135deg, var(--brand-red-light), rgba(255, 59, 48, 0.12))',
          border: '1px solid rgba(255, 59, 48, 0.2)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 16,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--brand-red)', marginBottom: 8, fontSize: 14 }}>
            ⚠️ 价格预警 ({alerts.length} 个商品降价)
          </div>
          {alerts.slice(0, 5).map((alert) => (
            <a key={alert.goods_id} href={`/products/${alert.goods_id}`}
               style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', color: 'var(--brand-text)', textDecoration: 'none', fontSize: 13 }}>
              {alert.image && <img src={alert.image} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.title}</span>
              <span style={{ color: 'var(--brand-text-secondary)' }}>¥{alert.prev_price}</span>
              <span style={{ color: 'var(--brand-red)', fontWeight: 600 }}>→ ¥{alert.current_price}</span>
              <span style={{ color: 'var(--brand-red)', fontSize: 12 }}>-{alert.drop_percent}%</span>
            </a>
          ))}
        </div>
      )}

      <div className={`stats-grid ${s.fadeIn} ${s.fadeInDelay1}`}>
        {STAT_CARDS.map((c) => (
          <div key={c.key} className="stat-card">
            <div className={`stat-icon ${c.icon}`}>{SHOP_ICON_SVG}</div>
            <div>
              <div className="stat-value">{data[c.key]}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={`grid-2 ${s.fadeIn} ${s.fadeInDelay2}`}>
        <div className="card">
          <div className="card-header">最近采集</div>
          <div className="card-body">
            {data.recent.length === 0 ? (
              <div className="empty">暂无采集记录</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>商品</th>
                      <th>价格</th>
                      <th>店铺</th>
                      <th>采集时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((g: GoodsInfo) => (
                      <tr key={g.goods_id}>
                        <td className={s.titleCell}>{g.title}</td>
                        <td className={s.priceCell}>¥{g.price.toFixed(2)}</td>
                        <td>{g.shop_name || '-'}</td>
                        <td className={s.timeCell}>{formatTime(g.crawl_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">店铺分布</div>
          <div className="card-body">
            {sortedShops.length === 0 ? (
              <div className="empty">暂无数据</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>店铺</th><th>商品数</th></tr>
                  </thead>
                  <tbody>
                    {sortedShops.map(([name, count]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td><span className="badge-orange badge">{String(count)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <>
      <div className="page-header"><h2>数据概览</h2></div>
      <div className="stats-grid">
        {[1, 2, 3].map((i) => (
          <div key={i} className={s.skeletonCard} />
        ))}
      </div>
    </>
  );
}

function formatTime(t: string): string {
  if (!t) return '-';
  const d = new Date(t);
  return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
