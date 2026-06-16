import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSearchProductsForEditor } from '../hooks/useApi';
import { fetchCompare } from '../api/index';
import type { CompareItem, AiEditorProduct } from '../types';
import s from '../styles/modules/Compare.module.css';

const MAX_COMPARE = 4;

const ATTR_ROWS: { label: string; key: string; render?: (item: CompareItem) => React.ReactNode }[] = [
  {
    label: '商品图片',
    key: 'image',
    render: (item) => (
      <img
        className={s.productImage}
        src={item.main_images[0] || ''}
        alt={item.title}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    ),
  },
  {
    label: '商品标题',
    key: 'title',
    render: (item) => (
      <Link to={`/product/${item.goods_id}`} className={s.productCell}>
        {item.title || '-'}
      </Link>
    ),
  },
  {
    label: '副标题',
    key: 'subtitle',
    render: (item) => <span>{item.subtitle || '-'}</span>,
  },
  {
    label: '团购价',
    key: 'min_group_price',
    render: (item) => (
      <span>
        <span className={s.priceValue}>¥{item.min_group_price?.toFixed(2) || '-'}</span>
      </span>
    ),
  },
  {
    label: '原价',
    key: 'original_price',
    render: (item) => (
      <span>
        <span className={s.priceValue}>¥{item.original_price?.toFixed(2) || '-'}</span>
      </span>
    ),
  },
  {
    label: '售价',
    key: 'price',
    render: (item) => (
      <span>
        <span className={s.priceValue}>¥{item.price?.toFixed(2) || '-'}</span>
      </span>
    ),
  },
  {
    label: '销量',
    key: 'sales',
    render: (item) => <span className={s.salesValue}>{item.sales?.toLocaleString() || '0'}</span>,
  },
  {
    label: '已拼件数',
    key: 'sold_quantity',
    render: (item) => <span className={s.salesValue}>{item.sold_quantity?.toLocaleString() || '0'}</span>,
  },
  {
    label: '店铺',
    key: 'shop_name',
    render: (item) => <span>{item.shop_name || '-'}</span>,
  },
  {
    label: '卖点',
    key: 'selling_points',
    render: (item) => (
      item.selling_points && item.selling_points.length > 0
        ? (
          <div className={s.tagList}>
            {item.selling_points.map((pt, i) => (
              <span key={i} className={s.tag}>{pt}</span>
            ))}
          </div>
        )
        : <span>-</span>
    ),
  },
  {
    label: '主图数量',
    key: 'main_images',
    render: (item) => <span>{item.main_images?.length || 0} 张</span>,
  },
  {
    label: '详情图数量',
    key: 'detail_images',
    render: (item) => <span>{item.detail_images?.length || 0} 张</span>,
  },
  {
    label: '规格',
    key: 'specs',
    render: (item) => {
      const specs = item.specs || {};
      const keys = Object.keys(specs);
      if (keys.length === 0) return <span>-</span>;
      return (
        <div className={s.tagList}>
          {keys.map(k => (
            <span key={k} className={s.tag}>{k}: {(specs[k] || []).join(', ')}</span>
          ))}
        </div>
      );
    },
  },
  {
    label: '属性',
    key: 'attributes',
    render: (item) => {
      const attrs = item.attributes || {};
      const keys = Object.keys(attrs);
      if (keys.length === 0) return <span>-</span>;
      return (
        <div className={s.tagList}>
          {keys.map(k => (
            <span key={k} className={s.tag}>{k}: {attrs[k]}</span>
          ))}
        </div>
      );
    },
  },
];

export default function Compare() {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('compare_selected') || '[]');
      return Array.isArray(stored) ? stored.slice(0, MAX_COMPARE) : [];
    } catch { return []; }
  });
  const [selectedItems, setSelectedItems] = useState<CompareItem[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: searchData } = useSearchProductsForEditor(searchKeyword);
  const searchResults = useMemo(() => searchData?.items || [], [searchData]);

  const filteredResults = useMemo(() => {
    return searchResults.filter(p => !selectedIds.includes(p.goods_id));
  }, [searchResults, selectedIds]);

  useEffect(() => {
    if (selectedIds.length >= 2) {
      setLoading(true);
      fetchCompare(selectedIds)
        .then(data => { setSelectedItems(data); })
        .catch(() => { setError('获取对比数据失败，请重试'); })
        .finally(() => { setLoading(false); setError(''); });
    } else {
      setSelectedItems([]);
    }
  }, [selectedIds]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = useCallback(() => {
    setSearchKeyword(searchInput.trim());
    if (searchInput.trim()) setShowDropdown(true);
  }, [searchInput]);

  const handleInputChange = useCallback((val: string) => {
    setSearchInput(val);
    if (val.trim()) {
      setSearchKeyword(val.trim());
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  }, []);

  const handleAddProduct = useCallback((product: AiEditorProduct) => {
    if (selectedIds.length >= MAX_COMPARE) return;
    if (selectedIds.includes(product.goods_id)) return;
    setSelectedIds(prev => [...prev, product.goods_id]);
    setSearchInput('');
    setSearchKeyword('');
    setShowDropdown(false);
  }, [selectedIds]);

  const handleRemoveProduct = useCallback((goodsId: string) => {
    setSelectedIds(prev => prev.filter(id => id !== goodsId));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedIds([]);
    setSelectedItems([]);
    setSearchInput('');
    setSearchKeyword('');
    localStorage.removeItem('compare_selected');
  }, []);

  const handleExportCsv = useCallback(() => {
    if (selectedItems.length === 0) return;
    const headers = ['属性', ...selectedItems.map(item => item.title || item.goods_id)];
    const rows = ATTR_ROWS.map(attr => {
      const col = [attr.label];
      for (const item of selectedItems) {
        let val = '';
        switch (attr.key) {
          case 'image': val = item.main_images?.[0] || ''; break;
          case 'title': val = item.title || ''; break;
          case 'subtitle': val = item.subtitle || ''; break;
          case 'min_group_price': val = String(item.min_group_price ?? ''); break;
          case 'original_price': val = String(item.original_price ?? ''); break;
          case 'price': val = String(item.price ?? ''); break;
          case 'sales': val = String(item.sales ?? ''); break;
          case 'sold_quantity': val = String(item.sold_quantity ?? ''); break;
          case 'shop_name': val = item.shop_name || ''; break;
          case 'selling_points': val = (item.selling_points || []).join('; '); break;
          case 'main_images': val = String(item.main_images?.length || 0); break;
          case 'detail_images': val = String(item.detail_images?.length || 0); break;
          case 'specs': val = Object.entries(item.specs || {}).map(([k, v]) => `${k}: ${v.join(',')}`).join('; '); break;
          case 'attributes': val = Object.entries(item.attributes || {}).map(([k, v]) => `${k}: ${v}`).join('; '); break;
        }
        col.push(val);
      }
      return col;
    });

    const bom = '\uFEFF';
    const csvContent = bom + [headers, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `商品对比_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedItems]);

  return (
    <div className={s.container}>
      <div className="page-header">
        <h2>商品对比</h2>
        <small>最多同时对比 {MAX_COMPARE} 个商品</small>
      </div>

      <div className={s.searchBar}>
        <div className={s.chips}>
          {selectedIds.length > 0 && selectedIds.map(gid => {
            const item = selectedItems.find(i => i.goods_id === gid);
            const title = item?.title || gid;
            return (
              <span key={gid} className={s.chip}>
                <span>{title.length > 15 ? title.slice(0, 15) + '…' : title}</span>
                <button className={s.chipRemove} onClick={() => handleRemoveProduct(gid)} aria-label={`移除 ${title}`}>×</button>
              </span>
            );
          })}
          {selectedIds.length === 0 && (
            <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>请搜索并添加商品进行对比</span>
          )}
        </div>

        {selectedIds.length >= 2 && (
          <button className="btn btn-primary btn-sm" onClick={handleExportCsv}>
            导出 CSV
          </button>
        )}
        {selectedIds.length > 0 && (
          <button className="btn btn-outline btn-sm" onClick={handleClearAll}>
            清空
          </button>
        )}

        <div className={s.searchWrapper} ref={searchRef}>
          <input
            className={s.searchInput}
            value={searchInput}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => { if (searchInput.trim()) setShowDropdown(true); }}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            placeholder={selectedIds.length >= MAX_COMPARE ? '已添加最大数量' : '搜索商品名称…'}
            disabled={selectedIds.length >= MAX_COMPARE}
            aria-label="搜索商品加入对比"
          />
          {showDropdown && filteredResults.length > 0 && (
            <div className={s.searchDropdown}>
              {filteredResults.slice(0, 10).map(product => (
                <div
                  key={product.goods_id}
                  className={s.searchDropdownItem}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleAddProduct(product)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleAddProduct(product); }}
                >
                  {product.main_images[0] && (
                    <img className={s.searchDropdownThumb} src={product.main_images[0]} alt="" />
                  )}
                  <span className={s.searchDropdownTitle}>{product.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedIds.length < 2 && (
        <div className={s.emptyHint}>
          <div className={s.emptyIcon}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:28,height:28}}>
              <rect x="3" y="10" width="3" height="6" rx="0.5"/>
              <rect x="8.5" y="6" width="3" height="10" rx="0.5"/>
              <rect x="14" y="3" width="3" height="13" rx="0.5"/>
            </svg>
          </div>
          <div>请至少添加 2 个商品以开始对比</div>
          <div style={{ fontSize: 12, marginTop: 8, color: 'var(--gray-400)' }}>
            在上方搜索框中输入商品关键词，从下拉列表中选择商品
          </div>
        </div>
      )}

      {selectedIds.length >= 2 && (
        <div className={s.compareArea}>
          {error && <div style={{ textAlign: 'center', color: 'var(--brand-red)', padding: 16, fontSize: 13 }}>{error}</div>}
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-400)' }}>加载中...</div>
          ) : (
            <table className={s.compareTable}>
              <thead>
                <tr>
                  <th className={s.attrCell}>对比项</th>
                  {selectedItems.map(item => (
                    <th key={item.goods_id}>
                      <Link to={`/product/${item.goods_id}`} style={{ color: 'var(--blue-700)' }}>
                        {(item.title || '').length > 20 ? item.title.slice(0, 20) + '…' : item.title}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ATTR_ROWS.map(attr => (
                  <tr key={attr.key}>
                    <td className={s.attrCell}>{attr.label}</td>
                    {selectedItems.map(item => (
                      <td key={item.goods_id} className={s.productCell}>
                        {attr.render ? attr.render(item) : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
