import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useProducts, useDeleteProducts, useTags, useGroups, useCreateTag, useDeleteTag,
  useCreateGroup, useDeleteGroup, useBatchUpdate, useDuplicates,
} from '../hooks/useApi';
import SafeImage from '../components/SafeImage';
import s from '../styles/modules/Products.module.css';

export default function Products() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>();
  const [selectedTagId, setSelectedTagId] = useState<number | undefined>();

  const [batchModal, setBatchModal] = useState<string | null>(null);
  const [priceMultiply, setPriceMultiply] = useState('1.3');
  const [priceAdd, setPriceAdd] = useState('0');
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#3b82f6');
  const [groupName, setGroupName] = useState('');
  const [dupModal, setDupModal] = useState(false);
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [salesMin, setSalesMin] = useState('');
  const [salesMax, setSalesMax] = useState('');
  const [shopFilter, setShopFilter] = useState('');
  const [batchTagModal, setBatchTagModal] = useState(false);
  const [batchTagId, setBatchTagId] = useState<number | null>(null);

  const activeFilters = { min_price: priceMin, max_price: priceMax, min_sales: salesMin, max_sales: salesMax, shop: shopFilter };
  const { data } = useProducts(page, keyword, selectedTagId, selectedGroupId, activeFilters);
  const deleteMut = useDeleteProducts();
  const batchMut = useBatchUpdate();
  const { data: tags, refetch: refetchTags } = useTags();
  const { data: groups, refetch: refetchGroups } = useGroups();
  const createTagMut = useCreateTag();
  const deleteTagMut = useDeleteTag();
  const createGroupMut = useCreateGroup();
  const deleteGroupMut = useDeleteGroup();
  const { data: dupData, refetch: refetchDups, isFetching: dupLoading } = useDuplicates();

  const items = data?.items ?? [];
  const allIds = useMemo(() => items.map(g => g.goods_id), [items]);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  const toggle = useCallback((id: string) => {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allIds.every(id => next.has(id))) allIds.forEach(id => next.delete(id));
      else allIds.forEach(id => next.add(id));
      return next;
    });
  }, [allIds]);

  const handleSearch = useCallback(() => { setKeyword(searchInput); setPage(1); }, [searchInput]);

  const handleDeleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selected.size} 件商品？`)) return;
    try { await deleteMut.mutateAsync([...selected]); setSelected(new Set()); }
    catch { alert('删除失败'); }
  }, [selected, deleteMut]);

  const handleBatchPrice = useCallback(async () => {
    const ids = [...selected]; if (ids.length === 0) return;
    try {
      await batchMut.mutateAsync({ ids, updates: { price_multiply: parseFloat(priceMultiply) || 1, price_add: parseFloat(priceAdd) || 0 } });
      setBatchModal(null); alert(`已更新 ${ids.length} 件商品价格`);
    } catch { alert('改价失败'); }
  }, [selected, priceMultiply, priceAdd, batchMut]);

  const handleBatchTag = useCallback(async (tagId: number) => {
    const ids = [...selected]; if (ids.length === 0) return;
    try {
      await batchMut.mutateAsync({ ids, updates: { tags_add: [tagId] } });
      setBatchModal(null); alert(`已打标签`);
    } catch { alert('操作失败'); }
  }, [selected, batchMut]);

  const handleCreateTag = useCallback(async () => {
    if (!tagName.trim()) return;
    try { await createTagMut.mutateAsync({ name: tagName.trim(), color: tagColor }); setTagName(''); refetchTags(); }
    catch { alert('创建失败'); }
  }, [tagName, tagColor, createTagMut, refetchTags]);

  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim()) return;
    try { await createGroupMut.mutateAsync({ name: groupName.trim() }); setGroupName(''); refetchGroups(); }
    catch { alert('创建失败'); }
  }, [groupName, createGroupMut, refetchGroups]);

  const handleDetectDups = useCallback(async () => {
    setDupModal(true);
    try { await refetchDups(); } catch {}
  }, [refetchDups]);

  const handleBatchExport = useCallback(async () => {
    try {
      const ids = [...selected].join(',');
      const resp = await fetch(`/api/export?format=xlsx&goods_ids=${ids}`);
      if (!resp.ok) throw new Error('export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `export_${selected.size}_items.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert('导出失败'); }
  }, [selected]);

  const handleBatchTagConfirm = useCallback(async () => {
    if (!batchTagId || selected.size === 0) return;
    try {
      await batchMut.mutateAsync({ ids: [...selected], updates: { tags_add: [batchTagId] } });
      setBatchTagModal(false);
      setBatchTagId(null);
    } catch { alert('批量标签失败'); }
  }, [selected, batchTagId, batchMut]);

  return (
    <>
      <div className="page-header">
        <h2>商品列表</h2>
      </div>

      {/* 工具栏 */}
      <div className={s.toolbar}>
        <div className={s.toolbarSearch}>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索商品..." />
          <button className="btn btn-outline btn-sm" onClick={handleSearch}>搜索</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={toggleAll}>{allSelected ? "取消全选" : "全选"}</button>
        <button className="btn btn-outline btn-sm" onClick={handleDetectDups}>检测重复</button>
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>筛选:</span>
        <input placeholder="最低价" value={priceMin} onChange={e => setPriceMin(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="最低价格" />
        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>—</span>
        <input placeholder="最高价" value={priceMax} onChange={e => setPriceMax(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="最高价格" />
        <input placeholder="最低销量" value={salesMin} onChange={e => setSalesMin(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="最低销量" />
        <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>—</span>
        <input placeholder="最高销量" value={salesMax} onChange={e => setSalesMax(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="最高销量" />
        <input placeholder="店铺名" value={shopFilter} onChange={e => setShopFilter(e.target.value)}
               style={{ width: 100, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="店铺名筛选" />
        <button className="btn btn-primary btn-sm" onClick={handleSearch}>筛选</button>
      </div>

      {/* 分组筛选 */}
      <div className={s.filterBar}>
        <div className={s.filterGroup}>
          <span className={s.filterLabel}>分组</span>
          <div className={s.filterPills}>
            <button className={`${s.filterPill} ${!selectedGroupId ? s.active : ''}`}
              onClick={() => { setSelectedGroupId(undefined); setPage(1); }}>全部</button>
            {groups?.map(g => (
              <span key={g.id} className={`${s.filterPill} ${selectedGroupId === g.id ? s.active : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span onClick={() => { setSelectedGroupId(g.id); setPage(1); }}>{g.name}</span>
                <button className={s.filterDel} title="删除分组"
                  onClick={(e) => { e.stopPropagation(); if (confirm('删除分组?')) deleteGroupMut.mutate(g.id, { onSuccess: refetchGroups }); }}>x</button>
              </span>
            ))}
          </div>
          <div className={s.filterCreate}>
            <input value={groupName} onChange={e => setGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateGroup()} placeholder="新分组" />
            <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px', fontSize: 12 }} onClick={handleCreateGroup}>+</button>
          </div>
        </div>
      </div>

      {/* 标签筛选 */}
      <div className={s.filterBar} style={{ marginBottom: 16 }}>
        <div className={s.filterGroup}>
          <span className={s.filterLabel}>标签</span>
          <div className={s.filterPills}>
            <button className={`${s.filterPill} ${!selectedTagId ? s.active : ''}`}
              onClick={() => { setSelectedTagId(undefined); setPage(1); }}>全部</button>
            {tags?.map(t => (
              <span key={t.id} className={`${s.filterPill} ${selectedTagId === t.id ? s.active : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className={s.filterDot} style={{ background: t.color }} />
                <span onClick={() => { setSelectedTagId(t.id); setPage(1); }}>{t.name}</span>
                <button className={s.filterDel} title="删除标签"
                  onClick={(e) => { e.stopPropagation(); if (confirm('删除标签?')) deleteTagMut.mutate(t.id, { onSuccess: refetchTags }); }}>x</button>
              </span>
            ))}
          </div>
          <div className={s.filterCreate}>
            <input type="color" value={tagColor} onChange={e => setTagColor(e.target.value)}
              className={s.filterColorPick} />
            <input value={tagName} onChange={e => setTagName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateTag()} placeholder="新标签" />
            <button className="btn btn-outline btn-sm" style={{ padding: '2px 8px', fontSize: 12 }} onClick={handleCreateTag}>+</button>
          </div>
        </div>
      </div>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 16px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#1e40af' }}>已选 {selected.size} 件</span>
          <button className="btn btn-outline btn-sm" onClick={() => setBatchModal('price')}>批量改价</button>
          <button className="btn btn-outline btn-sm" onClick={() => setBatchTagModal(true)}>批量标签</button>
          <button className="btn btn-outline btn-sm" onClick={handleBatchExport}>批量导出</button>
          <button className="btn btn-outline btn-sm" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={handleDeleteSelected}>批量删除</button>
          <button className="btn btn-outline btn-sm" onClick={() => setSelected(new Set())}>取消选择</button>
        </div>
      )}

      {/* 商品网格 */}
      {items.length === 0 ? (
        <div className="empty" style={{ padding: 60 }}>{keyword ? '未找到匹配商品' : '暂无商品'}</div>
      ) : (
        <div className={s.productGrid}>
          {items.map(g => (
            <div key={g.goods_id} className={`card ${s.productCard}`}>
              <div style={{ position: 'relative' }}>
                <input type="checkbox" checked={selected.has(g.goods_id)} onChange={() => toggle(g.goods_id)}
                  style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, width: 16, height: 16, accentColor: 'var(--orange-500)' }} />
                <div onClick={() => navigate(`/product/${g.goods_id}`)} style={{ cursor: 'pointer' }}>
                  <SafeImage src={g.main_images[0] || ''} alt={g.title} className={s.productImg} />
                </div>
              </div>
              <div className={s.productBody}>
                <div className={s.productTitle} onClick={() => navigate(`/product/${g.goods_id}`)}>{g.title}</div>
                <div className={s.productPrice}>
                  {(g as Record<string, unknown>).price_min != null && (g as Record<string, unknown>).price_max != null && (g as Record<string, unknown>).price_min !== (g as Record<string, unknown>).price_max
                    ? `¥${Number((g as Record<string, unknown>).price_min).toFixed(2)} ~ ¥${Number((g as Record<string, unknown>).price_max).toFixed(2)}`
                    : `¥${g.price.toFixed(2)}`
                  }
                </div>
                <div className={s.productMeta}>
                  {g.shop_name && <span>{g.shop_name}</span>}
                  {g.sales > 0 && <span>已拼 {g.sales.toLocaleString()}</span>}
                  {(g as Record<string, unknown>).total_stock != null && (
                    <span style={{
                      color: Number((g as Record<string, unknown>).total_stock) > 0 ? '#16a34a' : '#dc2626',
                      fontWeight: 500,
                    }}>
                      库存 {Number((g as Record<string, unknown>).total_stock)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {data && data.total > data.page_size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0' }}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span style={{ lineHeight: '28px', fontSize: 13, color: '#6b7280' }}>{page} / {totalPages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {/* 批量改价弹窗 */}
      {batchModal === 'price' && (
        <div style={overlayStyle} onClick={() => setBatchModal(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>批量改价（{selected.size} 件商品）</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#666' }}>倍数（如 1.3 表示加价 30%）</label>
                <input type="number" step="0.01" value={priceMultiply} onChange={e => setPriceMultiply(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#666' }}>固定加减（正数加价，负数减价）</label>
                <input type="number" step="0.01" value={priceAdd} onChange={e => setPriceAdd(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />
              </div>
              <p style={{ fontSize: 12, color: '#9ca3af' }}>新价格 = 原价 × 倍数 + 固定金额</p>
              <button className="btn btn-primary" onClick={handleBatchPrice}>确认改价</button>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setBatchModal(null)}>×</button>
          </div>
        </div>
      )}

      {/* 批量打标签弹窗 */}
      {batchModal === 'tag' && (
        <div style={overlayStyle} onClick={() => setBatchModal(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>批量打标签（{selected.size} 件商品）</h3>
            {tags && tags.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map(t => (
                  <button key={t.id} style={{ background: t.color, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 13 }}
                    onClick={() => handleBatchTag(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ color: '#9ca3af' }}>暂无标签，请先创建标签</p>
            )}
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setBatchModal(null)}>×</button>
          </div>
        </div>
      )}

      {/* 批量标签弹窗（下拉选择） */}
      {batchTagModal && (
        <div style={overlayStyle} onClick={() => setBatchTagModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>批量添加标签</h3>
            <select value={batchTagId || ''} onChange={e => setBatchTagId(Number(e.target.value))}
                    style={{ width: '100%', padding: 8, border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }}
                    aria-label="选择标签">
              <option value="">选择标签...</option>
              {tags?.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setBatchTagModal(false)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={!batchTagId} onClick={handleBatchTagConfirm}>确认</button>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setBatchTagModal(false)}>×</button>
          </div>
        </div>
      )}

      {/* 重复检测弹窗 */}
      {dupModal && (
        <div style={overlayStyle} onClick={() => setDupModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>重复商品检测</h3>
            {dupLoading ? <p>检测中...</p> : dupData && dupData.total_groups > 0 ? (
              <div>
                <p style={{ color: '#ef4444', marginBottom: 12 }}>发现 {dupData.total_groups} 组重复</p>
                {dupData.duplicates.map((group, i) => (
                  <div key={i} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 4 }}>
                      {group.type === 'exact_id' ? `ID 重复: ${group.goods_id}` : `标题相似: "${group.title_prefix}..."`}
                    </div>
                    {group.items.map((item, j) => (
                      <div key={j} style={{ fontSize: 13, padding: '2px 0', cursor: 'pointer', color: '#3b82f6' }}
                        onClick={() => { setDupModal(false); navigate(`/product/${item.goods_id}`); }}>
                        {item.goods_id} - {item.title.substring(0, 40)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#22c55e' }}>未发现重复商品</p>
            )}
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setDupModal(false)}>×</button>
          </div>
        </div>
      )}
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 24, maxWidth: 500, width: '90%', position: 'relative',
};