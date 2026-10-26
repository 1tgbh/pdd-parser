import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcknowledgeDiagnostic, useDiagnostics } from '../hooks/useApi';
import { evidenceTime, STAGE_LABELS, FIELD_LABELS } from '../utils/evidence';
import s from '../styles/modules/Evidence.module.css';

export default function Diagnostics() {
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState('');
  const [unread, setUnread] = useState(false);
  const { data, isLoading, isError, refetch } = useDiagnostics({ page, stage: stage || undefined, unread });
  const acknowledge = useAcknowledgeDiagnostic();
  return (
    <>
      <div className="page-header"><h2>异常诊断中心</h2><button className="btn btn-outline" onClick={() => refetch()}>刷新本地记录</button></div>
      <p className={s.note}>记录页面、同步、图片与导出各阶段的异常。字段缺失和图片失败不作为账号封禁判断。“标记已阅”不会解除采集暂停。</p>
      {data?.capture_state && !data.capture_state.enabled && <div className={s.card}><strong className={s.alert}>源侧保存已暂停</strong><p>{data.capture_state.reason}</p><small>人工检查后在扩展中明确恢复；已有商品仍可本地编辑。</small></div>}
      <div className={s.toolbar}>
        <select aria-label="异常阶段" value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}>
          <option value="">全部阶段</option>{Object.entries(STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); setPage(1); }} /> 只看未阅</label>
        <span className={s.small}>共 {data?.total ?? 0} 条，最多保留最近500条</span>
      </div>
      {isLoading && <p>加载中…</p>}
      {isError && <p role="alert">诊断记录读取失败，请检查本地后端。</p>}
      {data && !data.items.length && <div className={s.card}>暂无符合筛选条件的记录。</div>}
      {data?.items.map(item => (
        <article className={s.card} key={item.id}>
          <div className={s.heading}><strong>{item.message}</strong><span className={s.small}>{evidenceTime(item.occurred_at)} · {STAGE_LABELS[item.stage] || item.stage} · {item.acknowledged ? '已阅' : '未阅'}</span></div>
          <p className={s.note}>{item.hint}</p>
          {!!item.missing_fields?.length && <p className={s.small}>缺失字段：{item.missing_fields.map(field => FIELD_LABELS[field] || field).join('、')}</p>}
          <div className={s.small}>类别：{item.code} · HTTP：{item.http_status ?? '未观测'} · 解析版本：{item.parser_version}</div>
          <div className={s.small}>记录标识：{item.id}</div>
          {item.retry_at && <p className={s.small}>冷却结束参考时间：{evidenceTime(item.retry_at)}</p>}
          {item.source_url && <p className={s.small}>来源：{item.source_url}</p>}
          <div className={s.toolbar}>
            {item.goods_id && <Link to={`/product/${encodeURIComponent(item.goods_id)}`}>查看商品 {item.goods_id}</Link>}
            {!item.acknowledged && <button className="btn btn-outline btn-sm" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(item.id)}>标记已阅</button>}
          </div>
        </article>
      ))}
      {acknowledge.isError && <p role="alert">标记失败，请刷新后重试。</p>}
      <div className={s.toolbar}>
        <button className="btn btn-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
        <span>{page} / {Math.max(1, Math.ceil((data?.total || 0) / 30))}</span>
        <button className="btn btn-outline" disabled={!data || page * 30 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button>
      </div>
    </>
  );
}
