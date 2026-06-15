import { useState, useCallback, useEffect } from 'react';
import {
  useSearchProductsForEditor,
  useProduct,
  useAiCopywriting,
  useApplyCopywriting,
} from '../hooks/useApi';
import SafeImage from '../components/SafeImage';
import type { CopywritingResult } from '../types';
import s from '../styles/modules/AiCopywriting.module.css';

const COPY_TYPES = [
  { key: 'all', label: '全部' },
  { key: 'title', label: '标题' },
  { key: 'selling_points', label: '卖点' },
  { key: 'description', label: '详情' },
];

const STYLES = [
  { key: 'default', label: '通用' },
  { key: 'taobao', label: '淘宝' },
  { key: 'douyin', label: '抖音' },
  { key: 'pdd', label: '拼多多' },
];

const FIELD_LABELS: Record<string, string> = {
  title: '标题',
  subtitle: '副标题',
  selling_points: '卖点',
  description: '详情文案',
};

export default function AiCopywriting() {
  const [keyword, setKeyword] = useState('');
  const [selectedGoodsId, setSelectedGoodsId] = useState<string>('');
  const [copyType, setCopyType] = useState('all');
  const [style, setStyle] = useState('default');
  const [customPrompt, setCustomPrompt] = useState('');
  const [result, setResult] = useState<CopywritingResult | null>(null);
  const [copiedField, setCopiedField] = useState<string>('');
  const [searchDebounce, setSearchDebounce] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounce(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const searchQuery = useSearchProductsForEditor(searchDebounce);
  const productQuery = useProduct(selectedGoodsId || undefined);
  const copywritingMut = useAiCopywriting();
  const applyMut = useApplyCopywriting();

  const products = searchQuery.data?.items ?? [];
  const product = productQuery.data;

  const handleSelect = useCallback((goodsId: string) => {
    setSelectedGoodsId(goodsId);
    setResult(null);
  }, []);

  const handleGenerate = useCallback(() => {
    if (!selectedGoodsId) return;
    copywritingMut.mutate(
      { goodsId: selectedGoodsId, copyType, style, customPrompt: customPrompt || undefined },
      {
        onSuccess: (data) => {
          if ('error' in data && data.error) {
            alert(data.error);
            return;
          }
          setResult(data);
        },
      },
    );
  }, [selectedGoodsId, copyType, style, customPrompt, copywritingMut]);

  const handleCopy = useCallback((field: string, value: string | string[]) => {
    const text = Array.isArray(value) ? value.join('\n') : value;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    });
  }, []);

  const handleApplyField = useCallback((field: string, value: unknown) => {
    if (!selectedGoodsId) return;
    applyMut.mutate(
      { goodsId: selectedGoodsId, fields: { [field]: value } },
      { onSuccess: () => alert(`${FIELD_LABELS[field] || field} 已应用`) },
    );
  }, [selectedGoodsId, applyMut]);

  const handleApplyAll = useCallback(() => {
    if (!selectedGoodsId || !result) return;
    const fields: Record<string, unknown> = {};
    if (result.title) fields.title = result.title;
    if (result.subtitle) fields.subtitle = result.subtitle;
    if (result.selling_points) fields.selling_points = result.selling_points;
    if (result.description) fields.description = result.description;
    if (Object.keys(fields).length === 0) return;
    applyMut.mutate(
      { goodsId: selectedGoodsId, fields },
      { onSuccess: () => alert('全部文案已应用到商品') },
    );
  }, [selectedGoodsId, result, applyMut]);

  return (
    <>
      <div className="page-header">
        <h2>AI 文案生成</h2>
        <small>基于商品信息，一键生成多平台电商文案</small>
      </div>

      <div className={s.container}>
        <div className={s.leftCol}>
          <div className={s.card}>
            <div className={s.cardHeader}>选择商品</div>
            <div className={s.cardBody}>
              <input
                className={s.searchInput}
                placeholder="搜索商品名称或店铺…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="搜索商品"
              />
              <div className={s.productList}>
                {products.length === 0 && searchDebounce ? (
                  <div className={s.emptyHint}>未找到商品</div>
                ) : (
                  products.map((p) => (
                    <div
                      key={p.goods_id}
                      className={`${s.productItem} ${p.goods_id === selectedGoodsId ? s.productItemActive : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(p.goods_id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelect(p.goods_id); }}
                    >
                      <SafeImage src={p.main_images[0] || ''} alt={p.title} className={s.productThumb} />
                      <span className={s.productTitle}>{p.title}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {product && (
            <div className={s.card}>
              <div className={s.cardHeader}>当前商品信息</div>
              <div className={s.cardBody}>
                <div className={s.currentInfo}>
                  <InfoRow label="标题" value={product.title} />
                  <InfoRow label="副标题" value={product.subtitle || '—'} />
                  <InfoRow
                    label="卖点"
                    value={product.selling_points.length > 0 ? product.selling_points.join('、') : '—'}
                  />
                  <InfoRow label="描述" value={product.description ? product.description.slice(0, 120) + (product.description.length > 120 ? '…' : '') : '—'} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={s.rightCol}>
          <div className={s.card}>
            <div className={s.cardBody}>
              <div className={s.sectionLabel}>文案类型</div>
              <div className={s.typeBar}>
                {COPY_TYPES.map((t) => (
                  <button
                    key={t.key}
                    className={`${s.typeBtn} ${copyType === t.key ? s.typeBtnActive : ''}`}
                    onClick={() => setCopyType(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className={s.sectionLabel} style={{ marginTop: 16 }}>平台风格</div>
              <div className={s.styleBar}>
                {STYLES.map((st) => (
                  <button
                    key={st.key}
                    className={`${s.styleBtn} ${style === st.key ? s.styleBtnActive : ''}`}
                    onClick={() => setStyle(st.key)}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className={s.sectionLabel} style={{ marginTop: 16 }}>自定义要求（可选）</div>
              <textarea
                className={s.customPrompt}
                placeholder="例如：标题中包含'限时特惠'，卖点要突出材质和做工…"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                aria-label="自定义文案要求"
              />

              <button
                className={`btn btn-primary ${s.generateBtn}`}
                style={{ marginTop: 16 }}
                disabled={!selectedGoodsId || copywritingMut.isPending}
                onClick={handleGenerate}
              >
                {copywritingMut.isPending ? '生成中...' : '生成文案'}
              </button>
            </div>
          </div>

          {result && <ResultArea result={result} copiedField={copiedField} onCopy={handleCopy} onApplyField={handleApplyField} onApplyAll={handleApplyAll} applying={applyMut.isPending} />}

          {!result && (
            <div className={s.emptyResult}>
              <div className={s.emptyResultIcon}>✍️</div>
              选择商品并点击「生成文案」
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.infoRow}>
      <span className={s.infoLabel}>{label}</span>
      <span className={s.infoValue}>{value}</span>
    </div>
  );
}

interface ResultAreaProps {
  result: CopywritingResult;
  copiedField: string;
  onCopy: (field: string, value: string | string[]) => void;
  onApplyField: (field: string, value: unknown) => void;
  onApplyAll: () => void;
  applying: boolean;
}

function ResultArea({ result, copiedField, onCopy, onApplyField, onApplyAll, applying }: ResultAreaProps) {
  const entries: { field: string; label: string; value: string | string[] }[] = [];

  if (result.title) entries.push({ field: 'title', label: '标题', value: result.title });
  if (result.subtitle) entries.push({ field: 'subtitle', label: '副标题', value: result.subtitle });
  if (result.selling_points && result.selling_points.length > 0) {
    entries.push({ field: 'selling_points', label: '卖点', value: result.selling_points });
  }
  if (result.description) entries.push({ field: 'description', label: '详情文案', value: result.description });

  if (entries.length === 0) return null;

  return (
    <div className={s.resultsArea}>
      {entries.map((entry) => {
        const isArray = Array.isArray(entry.value);
        return (
          <div key={entry.field} className={s.resultCard}>
            <div className={s.resultCardHeader}>
              <span className={s.resultCardTitle}>{entry.label}</span>
              <div className={s.resultCardActions}>
                <button
                  className={`${s.copyBtn} ${copiedField === entry.field ? s.copied : ''}`}
                  onClick={() => onCopy(entry.field, entry.value)}
                >
                  {copiedField === entry.field ? '已复制' : '复制'}
                </button>
                <button
                  className={s.applyBtn}
                  onClick={() => onApplyField(entry.field, entry.value)}
                  disabled={applying}
                >
                  应用
                </button>
              </div>
            </div>
            {isArray ? (
              <div className={s.resultCardBodyList}>
                {(entry.value as string[]).map((item, idx) => (
                  <div key={idx} className={s.resultListItem}>{item}</div>
                ))}
              </div>
            ) : (
              <div className={s.resultCardBody}>{entry.value as string}</div>
            )}
          </div>
        );
      })}
      <button
        className={`btn btn-primary ${s.applyAllBtn}`}
        disabled={applying}
        onClick={onApplyAll}
      >
        {applying ? '应用中...' : '一键应用全部'}
      </button>
    </div>
  );
}
