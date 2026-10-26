import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useProducts, useDeleteProducts, useTags, useGroups, useCreateTag, useDeleteTag,
  useCreateGroup, useDeleteGroup, useBatchUpdate, useDuplicates, useShops,
  useSettings,
} from '../hooks/useApi';
import SafeImage from '../components/SafeImage';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { useKeyboard } from '../hooks/useKeyboard';
import { useSearchHistory } from '../hooks/useSearchHistory';
import { relativeTime } from '../utils/time';
import { exportGoods } from '../api';
import s from '../styles/modules/Products.module.css';

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirm } = useConfirm();
  const { history: searchHistory, add: addSearchHistory } = useSearchHistory();
  const [showHistory, setShowHistory] = useState(false);

  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') || '');
  const [searchInput, setSearchInput] = useState(() => searchParams.get('keyword') || '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<number | undefined>(() => {
    const v = searchParams.get('group'); return v ? Number(v) : undefined;
  });
  const [selectedTagId, setSelectedTagId] = useState<number | undefined>(() => {
    const v = searchParams.get('tag'); return v ? Number(v) : undefined;
  });

  const [batchModal, setBatchModal] = useState<string | null>(null);
  const [priceMultiply, setPriceMultiply] = useState('1.5');
  const [priceAdd, setPriceAdd] = useState('3');
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#FF9500');
  const [groupName, setGroupName] = useState('');
  const [dupModal, setDupModal] = useState(false);
  const [priceMin, setPriceMin] = useState(() => searchParams.get('min_price') || '');
  const [priceMax, setPriceMax] = useState(() => searchParams.get('max_price') || '');
  const [salesMin, setSalesMin] = useState(() => searchParams.get('min_sales') || '');
  const [salesMax, setSalesMax] = useState(() => searchParams.get('max_sales') || '');
  const [shopFilter, setShopFilter] = useState(() => searchParams.get('shop') || '');
  const [batchTagModal, setBatchTagModal] = useState(false);
  const [batchTagId, setBatchTagId] = useState<number | null>(null);
  const [density, setDensity] = useState<'compact' | 'standard' | 'relaxed'>(() => {
    return (localStorage.getItem('pdd_density') as 'compact' | 'standard' | 'relaxed') || 'standard';
  });

  const activeFilters = { min_price: priceMin, max_price: priceMax, min_sales: salesMin, max_sales: salesMax, shop: shopFilter };
  const { data, isFetching } = useProducts(page, keyword, selectedTagId, selectedGroupId, activeFilters);
  const { data: shopsData } = useShops();
  const shops = shopsData?.shops ?? [];
  const qc = useQueryClient();
  const handleRefreshKey = useCallback(() => qc.invalidateQueries({ queryKey: ['products'] }), [qc]);
  const searchRef = useRef<HTMLInputElement>(null);
  const handleSearchKey = useCallback(() => searchRef.current?.focus(), []);
  useKeyboard({ 'r': handleRefreshKey, '/': handleSearchKey });
  const deleteMut = useDeleteProducts();
  const batchMut = useBatchUpdate();
  const { data: settings } = useSettings();
  const priceMarkup = settings?.price_markup;
  const [prevPriceMarkup, setPrevPriceMarkup] = useState(priceMarkup);
  if (priceMarkup !== prevPriceMarkup) {
    setPrevPriceMarkup(priceMarkup);
    if (priceMarkup) { setPriceMultiply(String(priceMarkup.multiplier)); setPriceAdd(String(priceMarkup.fixed_amount)); }
  }
  const { data: tags, refetch: refetchTags } = useTags();
  const { data: groups, refetch: refetchGroups } = useGroups();
  const createTagMut = useCreateTag();
  const deleteTagMut = useDeleteTag();
  const createGroupMut = useCreateGroup();
  const deleteGroupMut = useDeleteGroup();
  const { data: dupData, refetch: refetchDups, isFetching: dupLoading } = useDuplicates();

  const items = useMemo(() => data?.items ?? [], [data]);
  const allIds = useMemo(() => items.map(g => g.goods_id), [items]);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const totalPages = data ? Math.ceil(data.total / data.page_size) : 1;

  useEffect(() => {
    const params: Record<string, string> = {};
    if (keyword) params.keyword = keyword;
    if (page > 1) params.page = String(page);
    if (selectedTagId) params.tag = String(selectedTagId);
    if (selectedGroupId) params.group = String(selectedGroupId);
    if (priceMin) params.min_price = priceMin;
    if (priceMax) params.max_price = priceMax;
    if (salesMin) params.min_sales = salesMin;
    if (salesMax) params.max_sales = salesMax;
    if (shopFilter) params.shop = shopFilter;
    setSearchParams(params, { replace: true });
  }, [keyword, page, selectedTagId, selectedGroupId, priceMin, priceMax, salesMin, salesMax, shopFilter, setSearchParams]);

  const handleDensityChange = useCallback((d: 'compact' | 'standard' | 'relaxed') => {
    setDensity(d);
    localStorage.setItem('pdd_density', d);
  }, []);

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

  const handleSearch = useCallback(() => {
    addSearchHistory(searchInput);
    setKeyword(searchInput);
    setPage(1);
    setShowHistory(false);
  }, [searchInput, addSearchHistory]);

  const handleHistoryClick = useCallback((kw: string) => {
    setSearchInput(kw);
    setKeyword(kw);
    setPage(1);
    setShowHistory(false);
  }, []);

  const handleCopyLink = useCallback((goodsId: string) => {
    const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}`;
    navigator.clipboard.writeText(url).then(() => toast.success('链接已复制'));
  }, [toast]);

  const handleDeleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const ok = await confirm({ title: '删除商品', message: `确定删除选中的 ${selected.size} 件商品？此操作不可恢复。`, confirmText: '删除', danger: true });
    if (!ok) return;
    try { await deleteMut.mutateAsync([...selected]); setSelected(new Set()); }
    catch { toast.error('删除失败'); }
  }, [selected, deleteMut, confirm, toast]);

  const handleBatchPrice = useCallback(async () => {
    const ids = [...selected]; if (ids.length === 0) return;
    try {
      const result = await batchMut.mutateAsync({ ids, updates: { price_multiply: parseFloat(priceMultiply) || 1, price_add: parseFloat(priceAdd) || 0 } });
      setBatchModal(null);
      const skipped = result.skipped || 0;
      if (skipped > 0) {
        toast.success(`已更新 ${ids.length - skipped} 件商品价格，跳过 ${skipped} 件已改价商品`);
      } else {
        toast.success(`已更新 ${ids.length} 件商品价格`);
      }
    } catch { toast.error('改价失败'); }
  }, [selected, priceMultiply, priceAdd, batchMut, toast]);

  const handleBatchTag = useCallback(async (tagId: number) => {
    const ids = [...selected]; if (ids.length === 0) return;
    try {
      await batchMut.mutateAsync({ ids, updates: { tags_add: [tagId] } });
      setBatchModal(null); toast.success(`已打标签`);
    } catch { toast.error('操作失败'); }
  }, [selected, batchMut, toast]);

  const handleCreateTag = useCallback(async () => {
    if (!tagName.trim()) return;
    try { await createTagMut.mutateAsync({ name: tagName.trim(), color: tagColor }); setTagName(''); refetchTags(); }
    catch { toast.error('创建失败'); }
  }, [tagName, tagColor, createTagMut, refetchTags, toast]);

  const handleCreateGroup = useCallback(async () => {
    if (!groupName.trim()) return;
    try { await createGroupMut.mutateAsync({ name: groupName.trim() }); setGroupName(''); refetchGroups(); }
    catch { toast.error('创建失败'); }
  }, [groupName, createGroupMut, refetchGroups, toast]);

  const handleDetectDups = useCallback(async () => {
    setDupModal(true);
    try { await refetchDups(); } catch { /* errors surface via query state */ }
  }, [refetchDups]);

  const handleBatchExport = useCallback(async () => {
    try {
      const ids = [...selected];
      const blob = await exportGoods(ids, 'excel');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `export_${selected.size}_items.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { toast.error('导出失败'); }
  }, [selected, toast]);

  const handleBatchTagConfirm = useCallback(async () => {
    if (!batchTagId || selected.size === 0) return;
    try {
      await batchMut.mutateAsync({ ids: [...selected], updates: { tags_add: [batchTagId] } });
      setBatchTagModal(false);
      setBatchTagId(null);
    } catch { toast.error('批量标签失败'); }
  }, [selected, batchTagId, batchMut, toast]);

  const gridClass = `${s.productGrid} ${density === 'compact' ? s.productGridCompact : density === 'relaxed' ? s.productGridRelaxed : ''}`;

  return (
    <>
      <div className="page-header">
        <h2>商品列表</h2>
      </div>

      <div className={s.toolbar}>
        <div className={s.toolbarSearch} style={{ position: 'relative' }}>
          <input ref={searchRef} value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
            onBlur={() => setTimeout(() => setShowHistory(false), 200)}
            placeholder="搜索商品..." />
          <button className="btn btn-outline btn-sm" onClick={handleSearch}>搜索</button>
          {showHistory && searchHistory.length > 0 && (
            <div className={s.searchHistory}>
              {searchHistory.map(kw => (
                <div key={kw} className={s.searchHistoryItem} onMouseDown={() => handleHistoryClick(kw)}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  {kw}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div className={s.densityGroup}>
          <button className={`${s.densityBtn} ${density === 'compact' ? s.active : ''}`} onClick={() => handleDensityChange('compact')}>紧凑</button>
          <button className={`${s.densityBtn} ${density === 'standard' ? s.active : ''}`} onClick={() => handleDensityChange('standard')}>标准</button>
          <button className={`${s.densityBtn} ${density === 'relaxed' ? s.active : ''}`} onClick={() => handleDensityChange('relaxed')}>宽松</button>
        </div>
        <button className="btn btn-outline btn-sm" onClick={toggleAll}>{allSelected ? "取消全选" : "全选"}</button>
        <button className="btn btn-outline btn-sm" onClick={() => qc.invalidateQueries({ queryKey: ['products'] })} disabled={isFetching}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 4, animation: isFetching ? 'spin 0.8s linear infinite' : 'none' }}>
            <path d="M13.5 8a5.5 5.5 0 01-9.4 3.5M2.5 8a5.5 5.5 0 019.4-3.5" />
            <path d="M13.5 3.5v4h-4" />
            <path d="M2.5 12.5v-4h4" />
          </svg>
          {isFetching ? '刷新中' : '刷新'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={handleDetectDups}>检测重复</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>筛选:</span>
        <input placeholder="最低价" value={priceMin} onChange={e => setPriceMin(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4, fontSize: 12 }} aria-label="最低价格" />
        <span style={{ color: 'var(--brand-text-muted)', fontSize: 12 }}>—</span>
        <input placeholder="最高价" value={priceMax} onChange={e => setPriceMax(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4, fontSize: 12 }} aria-label="最高价格" />
        <input placeholder="最低销量" value={salesMin} onChange={e => setSalesMin(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4, fontSize: 12 }} aria-label="最低销量" />
        <span style={{ color: 'var(--brand-text-muted)', fontSize: 12 }}>—</span>
        <input placeholder="最高销量" value={salesMax} onChange={e => setSalesMax(e.target.value)}
               style={{ width: 70, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4, fontSize: 12 }} aria-label="最高销量" />
        <select value={shopFilter} onChange={e => setShopFilter(e.target.value)}
                style={{ width: 120, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4, fontSize: 12 }} aria-label="店铺名筛选">
          <option value="">全部店铺</option>
          {shops.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={handleSearch}>筛选</button>
      </div>

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
                  onClick={async (e) => { e.stopPropagation(); const ok = await confirm({ title: '删除分组', message: '确定删除该分组？分组内的商品不会被删除。', confirmText: '删除', danger: true }); if (ok) deleteGroupMut.mutate(g.id, { onSuccess: () => { void refetchGroups(); } }); }}>x</button>
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
                  onClick={async (e) => { e.stopPropagation(); const ok = await confirm({ title: '删除标签', message: '确定删除该标签？关联将一并移除，商品会保留。', confirmText: '删除', danger: true }); if (ok) deleteTagMut.mutate(t.id, { onSuccess: () => { void refetchTags(); } }); }}>x</button>
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

      {selected.size > 0 && (
        <div style={{ background: 'var(--brand-accent-light)', border: '1px solid var(--brand-border)', borderRadius: 8, padding: '8px 16px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--brand-text-secondary)' }}>已选 {selected.size} 件</span>
          <button className="btn btn-outline btn-sm" onClick={() => setBatchModal('price')}>批量改价</button>
          <button className="btn btn-outline btn-sm" onClick={() => setBatchTagModal(true)}>批量标签</button>
          <button className="btn btn-outline btn-sm" onClick={handleBatchExport}>批量导出</button>
          <button className="btn btn-outline btn-sm" style={{ color: 'var(--brand-red)', borderColor: 'var(--brand-red)' }} onClick={handleDeleteSelected}>批量删除</button>
          <button className="btn btn-outline btn-sm" onClick={() => setSelected(new Set())}>取消选择</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty" style={{ padding: 60 }}>{keyword ? '未找到匹配商品' : '暂无商品'}</div>
      ) : (
        <div className={gridClass}>
          {items.map(g => {
            const g2 = g as unknown as Record<string, unknown>;
            const totalStock = Number(g2.total_stock ?? 0);
            return (
              <div key={g.goods_id} className={`card ${s.productCard}`}>
                <div style={{ position: 'relative' }}>
                  <input type="checkbox" checked={selected.has(g.goods_id)} onChange={() => toggle(g.goods_id)}
                    style={{ position: 'absolute', top: 8, left: 8, zIndex: 1, width: 16, height: 16, accentColor: 'var(--brand-accent)' }} />
                  {totalStock > 0 && totalStock <= 5 && (
                    <span className={s.stockBadge}>仅剩 {totalStock}</span>
                  )}
                  {g.price_modified === 1 && (
                    <span style={{ position: 'absolute', bottom: 8, right: totalStock > 0 && totalStock <= 5 ? 70 : 8, background: '#f59e0b', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4, zIndex: 1, fontWeight: 600 }}>已改价</span>
                  )}
                  <div className={s.cardActions}>
                    <button className={s.actionBtn} title="复制链接" onClick={(e) => { e.stopPropagation(); handleCopyLink(g.goods_id); }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M3 11V4a2 2 0 012-2h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <div onClick={() => navigate(`/product/${g.goods_id}`)} style={{ cursor: 'pointer' }}>
                    <SafeImage src={g.main_images[0] || ''} alt={g.title} className={s.productCardImg} />
                  </div>
                </div>
                <div className={s.productCardBody}>
                  <div className={s.productCardTitle} onClick={() => navigate(`/product/${g.goods_id}`)}>{g.title}</div>
                  <div className={s.productCardMeta}>
                    <span className={s.productCardPrice}>
                      {(() => {
                        let min = Number(g2.price_min ?? 0);
                        let max = Number(g2.price_max ?? 0);
                        if (min === 0 && max === 0) {
                          const skus = g2.skus as Array<Record<string, unknown>> | undefined;
                          if (Array.isArray(skus) && skus.length > 0) {
                            const prices = skus.map(s => Number(s.price || 0)).filter(p => p > 0);
                            if (prices.length > 0) { min = Math.min(...prices); max = Math.max(...prices); }
                          }
                        }
                        if (min === 0 && max === 0) {
                          const basePrice = Number(g.price || g.original_price || 0);
                          if (basePrice > 0) return <>¥{basePrice.toFixed(2)}</>;
                          return <span style={{ color: 'var(--brand-text-muted)' }}>暂无价格</span>;
                        }
                        if (min === 0 || min === max) return <>¥{max.toFixed(2)}</>;
                        return <>¥{min.toFixed(2)} ~ ¥{max.toFixed(2)}</>;
                      })()}
                    </span>
                    {g.sales > 0 && <span className={s.productCardSales}>已拼 {g.sales.toLocaleString()}</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    {g.shop_name && <span style={{ fontSize: 11, color: 'var(--brand-text-muted)' }}>{g.shop_name}</span>}
                    <span className={s.cardTime}>{relativeTime(g2.crawl_time as string)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && data.total > data.page_size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 0' }}>
          <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span style={{ lineHeight: '28px', fontSize: 13, color: 'var(--brand-text-secondary)' }}>{page} / {totalPages}</span>
          <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {batchModal === 'price' && (
        <div style={overlayStyle} onClick={() => setBatchModal(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>批量改价（{selected.size} 件商品）</h3>
              <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: '0 0 8px' }}>已改价的商品将自动跳过。公式来源：设置页改价公式配置。</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>倍数（如 1.3 表示加价 30%）</label>
                <input type="number" step="0.01" value={priceMultiply} onChange={e => setPriceMultiply(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>固定加减（正数加价，负数减价）</label>
                <input type="number" step="0.01" value={priceAdd} onChange={e => setPriceAdd(e.target.value)}
                  style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14 }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--brand-text-muted)' }}>新价格 = 原价 × 倍数 + 固定金额</p>
              <button className="btn btn-primary" onClick={handleBatchPrice}>确认改价</button>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setBatchModal(null)}>×</button>
          </div>
        </div>
      )}

      {batchModal === 'tag' && (
        <div style={overlayStyle} onClick={() => setBatchModal(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>批量打标签（{selected.size} 件商品）</h3>
            {tags && tags.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map(t => (
                  <button key={t.id} style={{ background: t.color, color: 'var(--brand-surface)', border: 'none', padding: '8px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 13 }}
                    onClick={() => handleBatchTag(t.id)}>
                    {t.name}
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--brand-text-muted)' }}>暂无标签，请先创建标签</p>
            )}
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setBatchModal(null)}>×</button>
          </div>
        </div>
      )}

      {batchTagModal && (
        <div style={overlayStyle} onClick={() => setBatchTagModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>批量添加标签</h3>
            <select value={batchTagId || ''} onChange={e => setBatchTagId(Number(e.target.value))}
                    style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 13 }}
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

      {dupModal && (
        <div style={overlayStyle} onClick={() => setDupModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>重复商品检测</h3>
            {dupLoading ? <p>检测中...</p> : dupData && dupData.total_groups > 0 ? (
              <div>
                <p style={{ color: 'var(--brand-red)', marginBottom: 12 }}>发现 {dupData.total_groups} 组重复</p>
                {dupData.duplicates.map((group, i) => (
                  <div key={i} style={{ background: 'var(--brand-red-light)', border: '1px solid rgba(255, 59, 48, 0.2)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--brand-red)', marginBottom: 4 }}>
                      {group.type === 'exact_id' ? `ID 重复: ${group.goods_id}` : `标题相似: "${group.title_prefix}..."`}
                    </div>
                    {group.items.map((item, j) => (
                      <div key={j} style={{ fontSize: 13, padding: '2px 0', cursor: 'pointer', color: 'var(--brand-accent)' }}
                        onClick={() => { setDupModal(false); navigate(`/product/${item.goods_id}`); }}>
                        {item.goods_id} - {item.title.substring(0, 40)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--brand-green)' }}>未发现重复商品</p>
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
  background: 'var(--brand-surface)', borderRadius: 12, padding: 24, maxWidth: 500, width: '90%', position: 'relative',
};
