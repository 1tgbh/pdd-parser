import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  useProduct, useUpdateProduct, usePackageGoods, useProductAiImages, useTags,
  useProductTags, useAiPresets, useAiEditImage, useAiUseImage, useAiRewrite,
  useUploadImage, useSetProductTags, useAddMonitor,
} from '../hooks/useApi';
import type { GoodsInfo, SkuItem } from '../types';
import s from '../styles/modules/ProductDetail.module.css';

function getImgUrl(path: string) {
  if (path.startsWith('http')) return path;
  return `/api/ai-image/${path.replace(/^\/+/, '')}`;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--brand-surface)', borderRadius: 12, padding: 24, maxWidth: 800, width: '90%', maxHeight: '85vh', overflow: 'auto', position: 'relative',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--brand-border)', fontWeight: 600, whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', borderBottom: '1px solid var(--brand-border)',
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [isEdit, setIsEdit] = useState(searchParams.get('edit') === '1');
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [mainImages, setMainImages] = useState<string[]>([]);
  const [detailImages, setDetailImages] = useState<string[]>([]);
  const [deletedMainIdx, setDeletedMainIdx] = useState<Set<number>>(new Set());
  const [deletedDetailIdx, setDeletedDetailIdx] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [aiEditModal, setAiEditModal] = useState<{ open: boolean; imageUrl: string }>({ open: false, imageUrl: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPreset, setAiPreset] = useState('');
  const [aiResults, setAiResults] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showRewrite, setShowRewrite] = useState(false);
  const [rewriteResult, setRewriteResult] = useState<Record<string, unknown> | null>(null);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteStyle, setRewriteStyle] = useState('default');
  const [showTagModal, setShowTagModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toastCompare, setToastCompare] = useState('');
  const [toastMonitor, setToastMonitor] = useState('');
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);

  const updateProduct = useUpdateProduct();
  const packageGoods = usePackageGoods();
  const aiEditImage = useAiEditImage();
  const aiUseImage = useAiUseImage();
  const aiRewrite = useAiRewrite();
  const uploadImage = useUploadImage();
  const setProductTags = useSetProductTags();
  const addMonitor = useAddMonitor();

  const { data: product, isLoading } = useProduct(id);
  const { data: aiPresets } = useAiPresets();
  const { data: aiImages } = useProductAiImages(id);
  const { data: allTags } = useTags();
  const { data: productTags } = useProductTags(id);

  useEffect(() => {
    if (product && isEdit) {
      setEditData({
        title: product.title || '',
        subtitle: product.subtitle || '',
        price: String(product.price || ''),
        original_price: String(product.original_price || ''),
        shop_name: product.shop_name || '',
        description: product.description || '',
      });
      setMainImages([...product.main_images]);
      setDetailImages([...product.detail_images]);
      setDeletedMainIdx(new Set());
      setDeletedDetailIdx(new Set());
    }
  }, [product, isEdit]);

  const displayImages = useMemo(() => {
    if (isEdit) {
      const main = mainImages.filter((_, i) => !deletedMainIdx.has(i));
      const detail = detailImages.filter((_, i) => !deletedDetailIdx.has(i));
      return [...main, ...detail].filter(Boolean);
    }
    return product ? [...product.main_images, ...product.detail_images].filter(Boolean) : [];
  }, [product, isEdit, mainImages, detailImages, deletedMainIdx, deletedDetailIdx]);

  useEffect(() => {
    if (activeImgIdx >= displayImages.length) {
      setActiveImgIdx(Math.max(0, displayImages.length - 1));
    }
  }, [displayImages.length, activeImgIdx]);

  const goBack = useCallback(() => navigate(-1), [navigate]);

  const setActiveImg = useCallback((idx: number) => () => setActiveImgIdx(idx), []);

  const toggleDeleteMain = useCallback((idx: number) => {
    setDeletedMainIdx(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const toggleDeleteDetail = useCallback((idx: number) => {
    setDeletedDetailIdx(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!id || !product) return;
    setIsExporting(true);
    try {
      const blob = await packageGoods.mutateAsync({ ids: [id], includeImages: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (product.title || product.goods_id).replace(/[/\\:*?"<>|]/g, '_').substring(0, 40) + '.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('导出失败');
    } finally {
      setIsExporting(false);
    }
  }, [id, product, packageGoods]);

  const toggleEdit = useCallback(() => {
    if (isEdit) {
      setIsEdit(false);
      navigate(`/product/${id}`, { replace: true });
    } else {
      setIsEdit(true);
      navigate(`/product/${id}?edit=1`, { replace: true });
    }
  }, [isEdit, id, navigate]);

  const updateEditData = useCallback((field: string, value: string) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!id) return;
    const fields: Record<string, unknown> = {};
    if (editData.title !== (product?.title || '')) fields.title = editData.title;
    if (editData.subtitle !== (product?.subtitle || '')) fields.subtitle = editData.subtitle;
    if (editData.price !== String(product?.price || '')) fields.price = parseFloat(editData.price) || 0;
    if (editData.original_price !== String(product?.original_price || '')) fields.original_price = parseFloat(editData.original_price) || 0;
    if (editData.shop_name !== (product?.shop_name || '')) fields.shop_name = editData.shop_name;
    if (editData.description !== (product?.description || '')) fields.description = editData.description;

    const filteredMain = mainImages.filter((_, i) => !deletedMainIdx.has(i));
    const filteredDetail = detailImages.filter((_, i) => !deletedDetailIdx.has(i));
    if (JSON.stringify(filteredMain) !== JSON.stringify(product?.main_images || [])) fields.main_images = filteredMain;
    if (JSON.stringify(filteredDetail) !== JSON.stringify(product?.detail_images || [])) fields.detail_images = filteredDetail;

    if (Object.keys(fields).length === 0) {
      setIsEdit(false);
      return;
    }
    try {
      await updateProduct.mutateAsync({ id, fields });
      setIsEdit(false);
      navigate(`/product/${id}`, { replace: true });
    } catch {
      alert('保存失败');
    }
  }, [id, editData, product, updateProduct, navigate, mainImages, detailImages, deletedMainIdx, deletedDetailIdx]);

  const openAiEdit = useCallback((imageUrl: string) => {
    setAiEditModal({ open: true, imageUrl });
    setAiPrompt('');
    setAiPreset('');
    setAiResults([]);
  }, []);

  const handleAiEdit = useCallback(async () => {
    if (!id || (!aiPrompt && !aiPreset)) return;
    setAiLoading(true);
    setAiResults([]);
    try {
      const result = await aiEditImage.mutateAsync({
        imageUrl: aiEditModal.imageUrl,
        prompt: aiPrompt,
        goodsId: id,
        preset: aiPreset || undefined,
      });
      const items = result.urls || result.paths || [];
      if (items.length > 0) setAiResults(items);
      else if (result.error) alert(result.error);
    } catch {
      alert('AI 编辑失败');
    } finally {
      setAiLoading(false);
    }
  }, [id, aiPrompt, aiPreset, aiEditModal.imageUrl, aiEditImage]);

  const handleUseAiImage = useCallback(async (imagePath: string, target: 'main' | 'detail') => {
    if (id) {
      try {
        await aiUseImage.mutateAsync({ goodsId: id, imagePath, target });
        setAiEditModal({ open: false, imageUrl: '' });
      } catch {
        alert('添加失败');
      }
    }
  }, [id, aiUseImage]);

  const handleRewrite = useCallback(async () => {
    if (!id) return;
    setRewriteLoading(true);
    setRewriteResult(null);
    setShowRewrite(true);
    try {
      const result = await aiRewrite.mutateAsync({ goodsId: id, style: rewriteStyle });
      if (result.result) setRewriteResult(result.result);
      else if (result.error) alert(result.error);
    } catch {
      alert('改写失败');
    } finally {
      setRewriteLoading(false);
    }
  }, [id, rewriteStyle, aiRewrite]);

  const handleApplyRewrite = useCallback((field: string, value: string) => {
    setEditData(prev => ({ ...prev, [field]: value }));
    if (!isEdit) setIsEdit(true);
  }, [isEdit]);

  const handleUploadImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    try {
      await uploadImage.mutateAsync({ goodsId: id, file, target: 'main' });
    } catch {
      alert('上传失败');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [id, uploadImage]);

  const downloadFile = useCallback(async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      alert('下载失败');
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (!product) return;
    setIsExporting(true);
    try {
      const allImgs = [...product.main_images, ...product.detail_images].filter(Boolean);
      for (let i = 0; i < allImgs.length; i++) {
        const prefix = i < product.main_images.length ? '主图' : '详情图';
        const num = i < product.main_images.length ? i + 1 : i - product.main_images.length + 1;
        await downloadFile(allImgs[i], prefix + '_' + num + '.jpg');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } finally {
      setIsExporting(false);
    }
  }, [product, downloadFile]);

  const toggleTag = useCallback(async (tagId: number) => {
    if (!id) return;
    const isRemove = productTags?.some(t => t.id === tagId);
    await setProductTags.mutateAsync({ goodsId: id, tagIds: [tagId], remove: isRemove });
  }, [id, productTags, setProductTags]);

  const handleAddCompare = useCallback(() => {
    if (!id) return;
    const key = 'compare_selected';
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    if (list.includes(id)) {
      setToastCompare('已在对比列表中');
      setTimeout(() => setToastCompare(''), 2000);
      return;
    }
    if (list.length >= 4) {
      setToastCompare('最多对比 4 个商品');
      setTimeout(() => setToastCompare(''), 2000);
      return;
    }
    list.push(id);
    localStorage.setItem(key, JSON.stringify(list));
    setToastCompare('已加入对比');
    setTimeout(() => setToastCompare(''), 2000);
  }, [id]);

  const handleAddMonitor = useCallback(async () => {
    if (!id) return;
    try {
      await addMonitor.mutateAsync({ goodsId: id, frequency: 'daily' });
      setToastMonitor('已加入监控');
    } catch {
      setToastMonitor('添加失败或已在监控中');
    }
    setTimeout(() => setToastMonitor(''), 2000);
  }, [id, addMonitor]);

  if (isLoading) return <Skeleton />;

  if (!product) return <div className="empty">商品不存在或已被删除</div>;

  const displayPrice = product.price > 0 ? product.price : product.original_price;
  const hasOriginalPrice = product.original_price > 0 && product.price > 0 && product.original_price !== product.price;
  const skus = (product.skus || []) as SkuItem[];

  return (
    <>
      <div className="page-header">
        <div className={s.backBtnGroup}>
          <button className="btn btn-outline btn-sm" onClick={goBack}>返回</button>
          <h2>商品详情</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="badge">ID: {product.goods_id}</span>
          {!isEdit && (
            <>
              <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? '导出中...' : '导出'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleDownloadAll} disabled={isExporting}>下载图片</button>
              <button className="btn btn-outline btn-sm" onClick={() => setShowTagModal(true)}>标签</button>
              <button className="btn btn-outline btn-sm" onClick={handleAddCompare}>加入对比</button>
              <button className="btn btn-outline btn-sm" onClick={handleAddMonitor}>加入监控</button>
              <button className="btn btn-outline btn-sm" onClick={() => { setRewriteStyle('default'); handleRewrite(); }}>AI 改写</button>
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={toggleEdit}>{isEdit ? '取消' : '编辑'}</button>
          {isEdit && <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>}
        </div>
      </div>

      <div className={s.detailLayout}>
        <div className={s.detailGallery}>
          <div className={s.detailThumbs}>
            {(displayImages || []).map((img, i) => (
              <div key={i} className={s.thumbWrap} onMouseEnter={setActiveImg(i)} style={{ position: 'relative' }}>
                <img src={img} alt={`${product.title} 图片 ${i + 1}`} className={i === activeImgIdx ? 'active' : ''} referrerPolicy="no-referrer" />
                <button onClick={() => openAiEdit(img)} style={{ position: 'absolute', bottom: 2, left: 2, background: 'rgba(0,0,0,0.7)', color: 'var(--brand-surface)', border: 'none', borderRadius: 3, fontSize: 10, padding: '1px 4px', cursor: 'pointer' }}>AI</button>
                <button onClick={e => { e.stopPropagation(); downloadFile(img, `图片_${i + 1}.jpg`); }} style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: 'var(--brand-surface)', border: 'none', borderRadius: 3, fontSize: 10, padding: '1px 4px', cursor: 'pointer' }}>⬇</button>
              </div>
            ))}
          </div>
          {displayImages.length > 0 ? (
            <img className={s.detailMainImg} src={displayImages[activeImgIdx] || displayImages[0]} alt={product.title} referrerPolicy="no-referrer" />
          ) : (
            <div className={s.noImage}>暂无图片</div>
          )}
          {isEdit && (
            <div style={{ marginTop: 8 }}>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleUploadImage} style={{ display: 'none' }} />
              <button className="btn btn-outline btn-sm" onClick={() => fileInputRef.current?.click()}>+ 上传图片</button>
            </div>
          )}
          {isEdit && displayImages.length > 0 && (
            <button className="btn btn-outline btn-sm" style={{ marginTop: 4 }} onClick={() => openAiEdit(displayImages[activeImgIdx])}>AI 编辑当前图片</button>
          )}
        </div>

        <div className={s.detailInfo}>
          {isEdit ? (
            <div className={s.editField}>
              <label>标题</label>
              <input value={editData.title || ''} onChange={e => updateEditData('title', e.target.value)} />
            </div>
          ) : (
            <div className={s.detailTitle}>{product.title}</div>
          )}

          {isEdit ? (
            <div className={s.editField}>
              <label>副标题</label>
              <input value={editData.subtitle || ''} onChange={e => updateEditData('subtitle', e.target.value)} />
            </div>
          ) : product.subtitle ? (
            <div className={s.detailSubtitle}>{product.subtitle}</div>
          ) : null}

          <div className={s.detailPrice}>
            {isEdit ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>¥</span>
                <input type="number" step="0.01" value={editData.price || ''} onChange={e => updateEditData('price', e.target.value)}
                  style={{ width: 100, padding: '4px 8px', border: '1px solid var(--brand-border)', borderRadius: 4 }} />
                {hasOriginalPrice && <small>¥{product.original_price.toFixed(2)}</small>}
              </div>
            ) : (
              <>
                ¥{displayPrice.toFixed(2) || '—'}
                {hasOriginalPrice && <small>¥{product.original_price.toFixed(2)}</small>}
              </>
            )}
          </div>

          <div className={s.detailMeta}>
            {(product.sales > 0 || product.sold_quantity > 0) && (
              <span>已拼 {(product.sales > 0 ? product.sales : product.sold_quantity).toLocaleString()} 件</span>
            )}
            {product.shop_name && <span>店铺：{product.shop_name}</span>}
          </div>

          {productTags && productTags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
              {(productTags || []).map(tag => (
                <span key={tag.id} style={{ background: tag.color, color: 'var(--brand-surface)', padding: '2px 8px', borderRadius: 10, fontSize: 11 }}>
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          {isEdit && (mainImages.length > 0 || detailImages.length > 0) && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">图片管理 <span className="badge">点击标记删除</span></div>
              <div className="card-body">
                {mainImages.length > 0 && (
                  <div className={s.imageGroup}>
                    <div className={s.imageGroupLabel}>主图 ({mainImages.length})</div>
                    <div className={s.imageGrid}>
                      {(mainImages || []).map((img, i) => (
                        <div key={`m${i}`} className={`${s.imageGridItem} ${deletedMainIdx.has(i) ? s.imageDeleted : ''}`}>
                          <img src={img} alt={`主图${i + 1}`} referrerPolicy="no-referrer" />
                          <button className={s.imageDeleteBtn} onClick={() => toggleDeleteMain(i)}>
                            {deletedMainIdx.has(i) ? '↩' : '✕'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detailImages.length > 0 && (
                  <div className={s.imageGroup}>
                    <div className={s.imageGroupLabel}>详情图 ({detailImages.length})</div>
                    <div className={s.imageGrid}>
                      {(detailImages || []).map((img, i) => (
                        <div key={`d${i}`} className={`${s.imageGridItem} ${deletedDetailIdx.has(i) ? s.imageDeleted : ''}`}>
                          <img src={img} alt={`详情图${i + 1}`} referrerPolicy="no-referrer" />
                          <button className={s.imageDeleteBtn} onClick={() => toggleDeleteDetail(i)}>
                            {deletedDetailIdx.has(i) ? '↩' : '✕'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className={s.deleteSummary}>待删除: {deletedMainIdx.size + deletedDetailIdx.size} 张</div>
              </div>
            </div>
          )}

          {aiImages && aiImages.length > 0 && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">AI 生成图片 <span className="badge">{aiImages.length} 张</span></div>
              <div className="card-body">
                <div className={s.imageGrid}>
                  {(aiImages || []).map(img => (
                    <div key={img.id} className={s.imageGridItem} style={{ width: 100, height: 100 }}>
                      <img src={`/api/ai-image/${img.result_path}`} alt={img.prompt} />
                      <button className={s.imageDeleteBtn} style={{ background: 'var(--brand-blue)', color: 'var(--brand-surface)' }}
                        onClick={() => handleUseAiImage(img.result_path, 'main')}>+</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {product.selling_points.length > 0 && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">卖点</div>
              <div className="card-body">
                <ul className={s.detailSellingPoints}>
                  {(product.selling_points || []).map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          )}

          {Object.keys(product.specs).length > 0 && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">规格</div>
              <div className="card-body">
                {Object.entries(product.specs || {}).map(([key, values]) => (
                  <div key={key} className={s.detailSpecRow}>
                    <div className={s.detailSpecLabel}>{key}</div>
                    <div className={s.detailSpecValues}>
                      {(Array.isArray(values) ? values : []).map(v => <span key={v} className="badge">{v}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {product.skus && product.skus.length > 0 && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">SKU 列表 <span className="badge-orange badge">{product.skus.length} 个</span></div>
              <div className={`card-body ${s.detailSectionBody}`}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>SKU ID</th><th>价格</th><th>库存</th><th>规格</th></tr>
                    </thead>
                    <tbody>
                      {product.skus.map(sku => (
                        <tr key={sku.sku_id}>
                          <td className={s.detailSkuId}>{sku.sku_id}</td>
                          <td className={s.detailSkuPrice}>¥{sku.price.toFixed(2)}</td>
                          <td>{sku.stock}</td>
                          <td>{Array.isArray(sku.specs) ? sku.specs.map(sp => `${sp.key}:${sp.value}`).join(' / ') : (sku.specs && typeof sku.specs === 'object' ? Object.entries(sku.specs).map(([k,v]) => `${k}:${v}`).join(' / ') : '-')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {skus.length > 0 && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">商品规格（SKU）</div>
              <div className="card-body">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>规格</th>
                        <th style={thStyle}>价格</th>
                        <th style={thStyle}>原价</th>
                        <th style={thStyle}>库存</th>
                        <th style={thStyle}>图片</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skus.map((sku, i) => (
                        <tr key={sku.sku_id || i}>
                          <td style={tdStyle}>{Array.isArray(sku.specs) ? sku.specs.map(sp => `${sp.key}: ${sp.value}`).join(' / ') : (sku.specs && typeof sku.specs === 'object' ? Object.entries(sku.specs).map(([k,v]) => `${k}: ${v}`).join(' / ') : '')}</td>
                          <td style={{ ...tdStyle, color: 'var(--brand-text)', fontWeight: 600 }}>¥{sku.price?.toFixed(2) || '0.00'}</td>
                          <td style={{ ...tdStyle, textDecoration: 'line-through', color: 'var(--brand-text-muted)' }}>
                            {sku.original_price > 0 ? `¥${sku.original_price.toFixed(2)}` : '-'}
                          </td>
                          <td style={tdStyle}>
                            {sku.stock > 0 ? (
                              <span style={{ color: 'var(--brand-green)' }}>{sku.stock}</span>
                            ) : (
                              <span style={{ color: 'var(--brand-red)' }}>缺货</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {sku.image && <img src={sku.image} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }} referrerPolicy="no-referrer" onClick={() => setLightboxImg(sku.image)} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {product.description && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">商品描述</div>
              <div className="card-body">{product.description}</div>
            </div>
          )}

          {product.source_url && (
            <div className={`card ${s.detailSection}`}>
              <div className="card-header">来源链接</div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <a href={product.source_url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--brand-blue)', wordBreak: 'break-all', fontSize: 13, flex: 1 }}>
                    {product.source_url}
                  </a>
                  <button className="btn btn-outline btn-sm" style={{ flexShrink: 0, fontSize: 12 }}
                    onClick={() => navigator.clipboard.writeText(product.source_url).then(() => {
                      const el = document.activeElement;
                      if (el) { el.textContent = '已复制'; setTimeout(() => { el.textContent = '复制'; }, 1500); }
                    })}>复制</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {aiEditModal.open && (
        <div style={overlayStyle} onClick={() => setAiEditModal({ open: false, imageUrl: '' })}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>AI 图片编辑</h3>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <img src={aiEditModal.imageUrl} alt="原图" style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8, background: 'var(--brand-bg)' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>预设模板</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {aiPresets && Object.entries(aiPresets).map(([key, val]) => (
                      <button key={key} className={`btn btn-sm ${aiPreset === key ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => { setAiPreset(aiPreset === key ? '' : key); setAiPrompt(''); }}>
                        {key === 'white_bg' ? '白底图' : key === 'scene' ? '场景图' : key === 'poster' ? '营销海报'
                          : key === 'remove_watermark' ? '去水印' : key === 'style_cartoon' ? '卡通风格' : val.substring(0, 6)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>自定义提示词</label>
                  <textarea value={aiPrompt} onChange={e => { setAiPrompt(e.target.value); setAiPreset(''); }}
                    placeholder="描述你想要的效果..." rows={3}
                    style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 13, resize: 'vertical' }} />
                </div>
                <button className="btn btn-primary" style={{ background: '#1d1d1f', color: '#fff', fontWeight: 500 }} onClick={handleAiEdit} disabled={aiLoading || (!aiPrompt && !aiPreset)}>
                  {aiLoading ? '生成中...' : '开始生成'}
                </button>
                {aiResults.length > 0 && (
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>生成结果</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                      {(aiResults || []).map((path, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img src={getImgUrl(path)} alt={`结果${i + 1}`}
                            style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--brand-border)' }} />
                          <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '2px 6px', background: '#1d1d1f', color: '#fff', fontWeight: 500 }}
                              onClick={() => handleUseAiImage(path, 'main')}>主图</button>
                            <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: '2px 6px', background: '#f2f2f7', border: '1px solid rgba(0,0,0,0.1)', color: '#1d1d1f', fontWeight: 500 }}
                              onClick={() => handleUseAiImage(path, 'detail')}>详情</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setAiEditModal({ open: false, imageUrl: '' })}>×</button>
          </div>
        </div>
      )}

      {showRewrite && (
        <div style={overlayStyle} onClick={() => setShowRewrite(false)}>
          <div style={{ ...modalStyle, maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>AI 文案改写</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['default', 'taobao', 'douyin', 'pdd'].map(style => (
                <button key={style} className={`btn btn-sm ${rewriteStyle === style ? 'btn-primary' : 'btn-outline'}`}
                  style={rewriteStyle === style ? { background: '#1d1d1f', color: '#fff', fontWeight: 500 } : { background: '#f2f2f7', border: '1px solid rgba(0,0,0,0.1)', color: '#1d1d1f', fontWeight: 500 }}
                  onClick={() => setRewriteStyle(style)}>
                  {style === 'default' ? '通用' : style === 'taobao' ? '淘宝' : style === 'douyin' ? '抖音' : '拼多多'}
                </button>
              ))}
              <button className="btn btn-primary btn-sm" style={{ background: '#1d1d1f', color: '#fff', fontWeight: 500 }} onClick={handleRewrite} disabled={rewriteLoading}>
                {rewriteLoading ? '改写中...' : '重新改写'}
              </button>
            </div>
            {rewriteLoading && <p style={{ color: 'var(--brand-text-secondary)' }}>正在改写，请稍候...</p>}
            {rewriteResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(rewriteResult).map(([field, value]) => (
                  <div key={field} style={{ background: 'var(--brand-bg)', padding: 12, borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--brand-text-secondary)', marginBottom: 4 }}>{field}</div>
                    <div style={{ fontSize: 14, lineHeight: 1.6 }}>{String(value)}</div>
                    <button className="btn btn-outline btn-sm" style={{ marginTop: 8, background: '#1d1d1f', color: '#fff', border: 'none', fontWeight: 500 }}
                      onClick={() => { handleApplyRewrite(field, String(value)); setShowRewrite(false); }}>应用到商品</button>
                  </div>
                ))}
              </div>
            )}
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setShowRewrite(false)}>×</button>
          </div>
        </div>
      )}

      {showTagModal && (
        <div style={overlayStyle} onClick={() => setShowTagModal(false)}>
          <div style={{ ...modalStyle, maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>商品标签</h3>
            {allTags && allTags.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(allTags || []).map(tag => {
                  const isActive = productTags?.some(t => t.id === tag.id);
                  return (
                    <button key={tag.id}
                      style={{
                        background: isActive ? tag.color : 'var(--brand-bg)', color: isActive ? 'var(--brand-surface)' : 'var(--brand-text)',
                        border: 'none', padding: '6px 14px', borderRadius: 16, cursor: 'pointer', fontSize: 13,
                      }}
                      onClick={() => toggleTag(tag.id)}>
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: 'var(--brand-text-muted)' }}>暂无标签，请先在商品列表页面创建标签</p>
            )}
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setShowTagModal(false)}>×</button>
          </div>
        </div>
      )}

      {(toastCompare || toastMonitor) && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--brand-text)', color: 'var(--brand-surface)', padding: '10px 24px', borderRadius: 8, fontSize: 14,
          zIndex: 1100, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toastCompare || toastMonitor}
        </div>
      )}

      {lightboxImg && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }} referrerPolicy="no-referrer" onClick={e => e.stopPropagation()} />
          <button style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 40, height: 40, borderRadius: 20, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setLightboxImg(null)}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="18" height="18"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>
          </button>
        </div>
      )}
    </>
  );
}

function Skeleton() {
  return (
    <>
      <div className="page-header"><h2>商品详情</h2></div>
      <div className={s.skeletonDetail}>
        <div className={s.skeletonDetailImg} />
        <div className={s.skeletonDetailInfo}>
          <div className={s.skeletonLine} />
          <div className={s.skeletonPrice} />
          <div className={s.skeletonLineSm} />
        </div>
      </div>
    </>
  );
}
