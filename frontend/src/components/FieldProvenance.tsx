import { useState } from 'react';
import { useProductProvenance } from '../hooks/useApi';
import type { ProvenanceField } from '../types';
import { FIELD_LABELS, ORIGIN_LABELS, evidenceTime, evidenceValue } from '../utils/evidence';
import s from '../styles/modules/Evidence.module.css';

function EvidenceTable({ fields }: { fields: ProvenanceField[] }) {
  return <div className={s.tableWrap}><table className={s.table}>
    <thead><tr><th>字段</th><th>当前值／来源</th><th>当前值证据</th><th>最近源侧观测</th><th>保护</th></tr></thead>
    <tbody>{fields.map(field => <tr key={field.field}>
      <td>{FIELD_LABELS[field.field] || field.field}</td>
      <td><div className={s.value}>{evidenceValue(field.current_value, field.status)}</div><small>{ORIGIN_LABELS[field.origin] || field.origin}</small></td>
      <td><div className={s.value}>原始值：{evidenceValue(field.raw_value)}</div><div className={s.value}>规范值：{evidenceValue(field.normalized_value, field.status)}</div>
        <div className={s.small}>{field.source_field || '原位置未记录'}<br />观测：{evidenceTime(field.observed_at)}<br />{field.modified_at && <>人工修改：{evidenceTime(field.modified_at)}<br /></>}版本：{field.parser_version || '未知'}</div></td>
      <td>{field.latest_observation ? <><div className={s.value}>{evidenceValue(field.latest_observation.normalized_value, field.latest_observation.status)}</div><div className={s.small}>{evidenceTime(field.latest_observation.observed_at)}<br />{field.latest_observation.source_field}<br />{field.latest_observation.source_url}</div></> : '无逐字段观测记录'}</td>
      <td>{field.protected ? '人工值受保护' : '正常合并'}</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function FieldProvenance({ goodsId, revision }: { goodsId: string; revision?: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useProductProvenance(goodsId, revision, open);
  return <details className={s.card} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className={s.summary}>字段来源与人工编辑保护</summary>
    <p className={s.note}>当前编辑值与最近实际观测分开记录。未获取的价格／库存显示未知；旧数据没有逐字段记录时标为“历史来源未记录”。计算／合并值不冒充新的平台观测。</p>
    {isLoading && <p>加载来源记录…</p>}
    {isError && <p role="alert">来源记录读取失败，请检查后端。</p>}
    {data && <>
      <p className={s.small}>最近源侧观测：{evidenceTime(data.observed_at)} · 本地更新：{evidenceTime(data.updated_at)}<br />来源：{data.source_url || '未记录'}</p>
      <EvidenceTable fields={data.fields} />
      <p className={s.note}>SKU逐字段记录：{data.skus.length} 个</p>
      {data.skus.slice(0, 100).map(sku => <details key={sku.key}><summary className={s.summary}>{sku.sku_id || '未识别ID'} · {sku.specs.map(p => `${p.key}:${p.value}`).join(' / ')}</summary><EvidenceTable fields={sku.fields} /></details>)}
      {data.skus.length > 100 && <p className={s.note}>为避免页面过大，仅展示前100个SKU来源记录。</p>}
    </>}
  </details>;
}
