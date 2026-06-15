import { useState, useCallback, useMemo } from 'react';
import { useProducts, useExportGoods, usePackageGoods, useDeleteProducts, useExportTemplates, useAllProductIds } from '../hooks/useApi';
import { createExportTemplate, updateExportTemplate, deleteExportTemplate } from '../api';
import SafeImage from '../components/SafeImage';
import type { ExportFormat, ExportTemplate } from '../types';
import s from '../styles/modules/Export.module.css';

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: 'excel', label: 'Excel' },
  { key: 'txt', label: 'TXT图文包（推荐）' },
  { key: 'dawang', label: '通用数据包（CSV）' },
  { key: 'dawang_wechat', label: '微信小店上货（CSV）' },
  { key: 'dawang_pdd', label: '拼多多上货（CSV）' },
  { key: 'dawang_raw', label: '原始数据包（JSON）' },
];

const ALL_FIELDS: { key: string; label: string }[] = [
  { key: 'goods_id', label: '商品ID' },
  { key: 'title', label: '商品标题' },
  { key: 'subtitle', label: '副标题' },
  { key: 'selling_points', label: '卖点' },
  { key: 'price', label: '价格' },
  { key: 'original_price', label: '原价' },
  { key: 'min_group_price', label: '团购价' },
  { key: 'sales', label: '销量' },
  { key: 'sold_quantity', label: '已拼件数' },
  { key: 'shop_name', label: '店铺名' },
  { key: 'shop_id', label: '店铺ID' },
  { key: 'main_images', label: '主图' },
  { key: 'detail_images', label: '详情图' },
  { key: 'specs', label: '规格' },
  { key: 'skus', label: 'SKU详情' },
  { key: 'description', label: '商品描述' },
  { key: 'attributes', label: '商品属性' },
  { key: 'source_url', label: '商品链接' },
  { key: 'crawl_time', label: '采集时间' },
];

const DOWNLOAD_ICON_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="auto-stop-icon">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1={12} y1={15} x2={12} y2={3} />
  </svg>
);

const PACKAGE_ICON_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="auto-stop-icon">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1={12} y1={22.08} x2={12} y2={12} />
  </svg>
);

interface ModalStyle {
  overlay: React.CSSProperties;
  content: React.CSSProperties;
}

const MODAL: ModalStyle = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  content: { background: '#fff', borderRadius: 12, padding: 24, width: '90%', maxWidth: 640, maxHeight: '85vh', overflow: 'auto', position: 'relative', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' },
};

export default function Export() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [selectAllLoading, setSelectAllLoading] = useState(false);
  const allIdsQuery = useAllProductIds();
  const [templateId, setTemplateId] = useState<number | undefined>();

  const { data } = useProducts(page, '');
  const exportMut = useExportGoods();
  const packageMut = usePackageGoods();
  const deleteMut = useDeleteProducts();
  const { data: templates, refetch: refetchTemplates } = useExportTemplates();

  const [tplModal, setTplModal] = useState<{ open: boolean; editing: ExportTemplate | null }>({ open: false, editing: null });
  const [tplName, setTplName] = useState('');
  const [tplFields, setTplFields] = useState<string[]>([]);
  const [tplColumnMap, setTplColumnMap] = useState<Record<string, string>>({});

  const items = data?.items ?? [];
  const allIds = useMemo(() => items.map((g) => g.goods_id), [items]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allIds.every((id) => next.has(id))) {
        allIds.forEach((id) => next.delete(id));
      } else {
        allIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allIds]);

  const handleDeleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selected.size} 件商品？此操作不可恢复。`)) return;
    try {
      await deleteMut.mutateAsync([...selected]);
      setSelected(new Set());
    } catch {
      alert('删除失败');
    }
  }, [selected, deleteMut]);

  const handleExport = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      const effectiveFormat = templateId ? 'excel' as ExportFormat : format;
      const blob = await exportMut.mutateAsync({ ids: [...selected], format: effectiveFormat, templateId });
      const ext = effectiveFormat === 'excel' ? 'xlsx' : (effectiveFormat === 'txt' || effectiveFormat === 'dawang_raw') ? 'zip' : (effectiveFormat === 'dawang' || effectiveFormat === 'dawang_wechat' || effectiveFormat === 'dawang_pdd') ? 'csv' : effectiveFormat;
      downloadBlob(blob, `商品导出_${new Date().toISOString().slice(0, 10)}.${ext}`);
    } catch (e) {
      alert('导出失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [selected, format, templateId, exportMut]);

  const handlePackage = useCallback(async () => {
    if (selected.size === 0) return;
    try {
      const blob = await packageMut.mutateAsync({ ids: [...selected], includeImages: true });
      downloadBlob(blob, `商品打包_${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) {
      alert('打包失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [selected, packageMut]);

  const handlePrev = useCallback(() => setPage((p) => p - 1), []);
  const handleNext = useCallback(() => setPage((p) => p + 1), []);

  const openNewTemplate = useCallback(() => {
    setTplModal({ open: true, editing: null });
    setTplName('');
    setTplFields([]);
    setTplColumnMap({});
  }, []);

  const openEditTemplate = useCallback((tpl: ExportTemplate) => {
    setTplModal({ open: true, editing: tpl });
    setTplName(tpl.name);
    setTplFields([...tpl.fields]);
    setTplColumnMap({ ...tpl.column_map });
  }, []);

  const closeTplModal = useCallback(() => {
    setTplModal({ open: false, editing: null });
  }, []);

  const toggleField = useCallback((fieldKey: string) => {
    setTplFields((prev) => {
      const next = prev.includes(fieldKey) ? prev.filter((f) => f !== fieldKey) : [...prev, fieldKey];
      return next;
    });
    setTplColumnMap((prev) => {
      if (prev[fieldKey]) return prev;
      const label = ALL_FIELDS.find((f) => f.key === fieldKey)?.label || fieldKey;
      return { ...prev, [fieldKey]: label };
    });
  }, []);

  const updateColumnLabel = useCallback((fieldKey: string, value: string) => {
    setTplColumnMap((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    if (!tplName.trim() || tplFields.length === 0) {
      alert('请填写模板名称并选择至少一个字段');
      return;
    }
    try {
      if (tplModal.editing) {
        await updateExportTemplate(tplModal.editing.id, tplName, tplFields, tplColumnMap);
      } else {
        await createExportTemplate(tplName, tplFields, tplColumnMap);
      }
      closeTplModal();
      refetchTemplates();
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [tplName, tplFields, tplColumnMap, tplModal.editing, closeTplModal, refetchTemplates]);

  const handleDeleteTemplate = useCallback(async (tpl: ExportTemplate) => {
    if (!window.confirm(`确定删除模板「${tpl.name}」？`)) return;
    try {
      await deleteExportTemplate(tpl.id);
      if (templateId === tpl.id) setTemplateId(undefined);
      refetchTemplates();
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [templateId, refetchTemplates]);

  return (
    <>
      <div className="page-header">
        <h2>数据导出</h2>
        <small>选中商品后导出数据或打包图片</small>
      </div>

      <div className={s.gridStart}>
        <div className="card">
          <div className="card-header">
            <span>选择商品（已选 {selected.size}）</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label className={s.selectAll}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className={s.checkbox} />
                全选本页
              </label>
              {data && data.total > items.length && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ fontSize: 12, padding: '2px 10px' }}
                  disabled={selectAllLoading}
                  onClick={async () => {
                    setSelectAllLoading(true);
                    try {
                      const result = await allIdsQuery.refetch();
                      if (result.data?.ids) {
                        setSelected(new Set(result.data.ids));
                      }
                    } finally {
                      setSelectAllLoading(false);
                    }
                  }}
                >
                  {selectAllLoading ? '加载中...' : `全选所有 ${data.total} 件商品`}
                </button>
              )}
            </div>
          </div>
          <div className={s.left}>
            {items.length === 0 ? (
              <div className="empty" style={{ padding: 40 }}>暂无商品</div>
            ) : (
              items.map((g) => (
                <label key={g.goods_id}>
                  <input
                    type="checkbox"
                    checked={selected.has(g.goods_id)}
                    onChange={() => toggle(g.goods_id)}
                    className={s.checkbox}
                  />
                  <SafeImage src={g.main_images[0] || ''} alt={g.title} className={s.itemCover} />
                  <span className={s.itemTitle}>{g.title}</span>
                  <span className={s.itemPrice}>¥{g.price.toFixed(2)}</span>
                </label>
              ))
            )}
          </div>

          {data && data.total > data.page_size ? (
            <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
              <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={handlePrev} aria-label="上一页">上一页</button>
              <span style={{ lineHeight: '28px', fontSize: 13, color: 'var(--gray-500)' }}>{page} / {totalPages}</span>
              <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={handleNext} aria-label="下一页">下一页</button>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">数据导出</div>
            <div className="card-body">
              <div className={s.formatBar}>
                {FORMATS.map((f) => (
                  <FormatButton
                    key={f.key}
                    active={format === f.key && !templateId}
                    label={f.label}
                    onClick={(k) => { setFormat(k); setTemplateId(undefined); }}
                    formatKey={f.key}
                  />
                ))}
              </div>

              <div className={s.templateRow}>
                <select
                  className={s.templateSelect}
                  value={templateId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTemplateId(v ? Number(v) : undefined);
                    if (v) setFormat('excel');
                  }}
                  aria-label="选择导出模板"
                >
                  <option value="">不使用模板</option>
                  {templates?.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.is_preset ? '📌 ' : ''}{tpl.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-outline btn-sm" onClick={openNewTemplate} aria-label="新建导出模板">+ 新建模板</button>
                {templateId && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      const tpl = templates?.find((t) => t.id === templateId);
                      if (tpl && !tpl.is_preset) openEditTemplate(tpl);
                    }}
                    disabled={!templates?.find((t) => t.id === templateId && !t.is_preset)}
                    aria-label="编辑模板"
                  >编辑</button>
                )}
              </div>

              <p className={s.desc}>
                {templateId
                  ? `使用模板「${templates?.find((t) => t.id === templateId)?.name || ''}」导出 Excel`
                  : format === "txt" ? "TXT商品说明 + 实际图片打包（推荐）" : format === "dawang_raw" ? "导出原始数据包（与大王解析格式一致，每个商品一个JSON文件）" : `选中 ${selected.size} 件商品，导出为 ${FORMATS.find((f) => f.key === format)?.label} 格式`}
              </p>
              <button className={`btn btn-primary ${s.btnFull}`} disabled={selected.size === 0} onClick={handleExport} aria-label="导出选中商品数据">
                {DOWNLOAD_ICON_SVG}
                导出数据
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">打包下载</div>
            <div className="card-body">
              <p className={s.desc}>打包下载选中商品的所有图片（主图 + 详情图 + SKU图）</p>
              <button className={`btn btn-primary ${s.btnFull}`} disabled={selected.size === 0} onClick={handlePackage} aria-label="打包下载选中商品图片">
                {PACKAGE_ICON_SVG}
                打包图片
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">批量操作</div>
            <div className="card-body">
              <p className={s.desc}>删除选中的商品数据（不可恢复）</p>
              <button className={`btn btn-outline ${s.btnFull}`} disabled={selected.size === 0} onClick={handleDeleteSelected} style={{ color: '#e74c3c', borderColor: '#e74c3c' }} aria-label="删除选中商品">
                删除选中商品
              </button>
            </div>
          </div>

          {templates && templates.length > 0 && (
            <div className="card">
              <div className="card-header">导出模板</div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {templates.map((tpl) => (
                  <div key={tpl.id} className={s.tplItem}>
                    <span className={s.tplName}>
                      {tpl.is_preset ? '📌 ' : ''}{tpl.name}
                      <small style={{ color: 'var(--gray-400)', marginLeft: 6 }}>{tpl.fields.length} 个字段</small>
                    </span>
                    <div className={s.tplActions}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11, padding: '2px 8px' }}
                        onClick={() => { setTemplateId(tpl.id); setFormat('excel'); }}
                      >使用</button>
                      {!tpl.is_preset && (
                        <>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openEditTemplate(tpl)}>编辑</button>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: '2px 8px', color: '#ef4444' }} onClick={() => handleDeleteTemplate(tpl)}>删除</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {tplModal.open && (
        <div style={MODAL.overlay} onClick={closeTplModal}>
          <div style={MODAL.content} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{tplModal.editing ? '编辑模板' : '新建模板'}</h3>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }} onClick={closeTplModal} aria-label="关闭模板编辑器">×</button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }} htmlFor="tpl-name-input">模板名称</label>
              <input
                id="tpl-name-input"
                type="text"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="输入模板名称"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>选择字段</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
                {ALL_FIELDS.map((f) => (
                  <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px', background: tplFields.includes(f.key) ? '#eff6ff' : 'transparent', borderRadius: 4, cursor: 'pointer', border: '1px solid ' + (tplFields.includes(f.key) ? '#bfdbfe' : 'var(--gray-100, #f3f4f6)') }}>
                    <input type="checkbox" checked={tplFields.includes(f.key)} onChange={() => toggleField(f.key)} className={s.checkbox} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            {tplFields.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>列名映射</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {tplFields.map((fk) => {
                    const label = ALL_FIELDS.find((f) => f.key === fk)?.label || fk;
                    return (
                      <div key={fk} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ width: 80, flexShrink: 0, color: 'var(--gray-500)' }}>{label}</span>
                        <span style={{ color: 'var(--gray-400)' }}>→</span>
                        <input
                          type="text"
                          value={tplColumnMap[fk] || ''}
                          onChange={(e) => updateColumnLabel(fk, e.target.value)}
                          placeholder={label}
                          style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={closeTplModal}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveTemplate}>
                {tplModal.editing ? '保存修改' : '创建模板'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface FormatButtonProps {
  active: boolean;
  label: string;
  formatKey: ExportFormat;
  onClick: (f: ExportFormat) => void;
}

function FormatButton({ active, label, formatKey, onClick }: FormatButtonProps) {
  const handleClick = useCallback(() => onClick(formatKey), [onClick, formatKey]);
  return (
    <button
      className={`btn ${active ? 'btn-primary' : 'btn-outline'} btn-sm`}
      onClick={handleClick}
      aria-label={`导出格式: ${label}`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
