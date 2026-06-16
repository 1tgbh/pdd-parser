import { useState, useCallback, useRef } from 'react';
import { usePreviewImport, useImportData, useImportRawJson, useImportRawJsonDir } from '../hooks/useApi';
import type { ImportPreview, ImportResult } from '../types';
import s from '../styles/modules/Import.module.css';

const FIELD_LABELS: Record<string, string> = {
  goods_id: '商品ID',
  title: '商品标题',
  subtitle: '副标题',
  price: '价格',
  original_price: '原价',
  min_group_price: '拼团价',
  sales: '销量',
  sold_quantity: '已拼件数',
  shop_name: '店铺名称',
  shop_id: '店铺ID',
  main_images: '主图链接',
  detail_images: '详情图链接',
  description: '商品描述',
  specs: '规格信息',
  skus: 'SKU详情',
  attributes: '商品属性',
  source_url: '商品链接',
  selling_points: '卖点标签',
  category: '类目',
};

export default function Import() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, number>>({});

  const previewMut = usePreviewImport();
  const importMut = useImportData();

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setResult(null);
    setPreview(null);
    try {
      const data = await previewMut.mutateAsync(f);
      setPreview(data);
      setColumnMapping(data.detected_mapping || {});
    } catch {
      setResult(null);
    }
  }, [previewMut]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleImport = useCallback(async () => {
    if (!file) return;
    try {
      const data = await importMut.mutateAsync({ file, columnMapping });
      setResult(data);
    } catch {
      setResult(null);
    }
  }, [file, columnMapping, importMut]);

  // Raw JSON import
  const rawJsonRef = useRef<HTMLInputElement>(null);
  const [rawJsonFiles, setRawJsonFiles] = useState<File[]>([]);
  const [rawJsonResult, setRawJsonResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [rawJsonDir, setRawJsonDir] = useState('');
  const rawJsonMut = useImportRawJson();
  const rawJsonDirMut = useImportRawJsonDir();

  const handleRawJsonFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter(f => f.name.endsWith('.txt') || f.name.endsWith('.json'));
    setRawJsonFiles(arr);
    setRawJsonResult(null);
  }, []);

  const handleRawJsonImport = useCallback(async () => {
    if (rawJsonFiles.length === 0) return;
    try {
      const data = await rawJsonMut.mutateAsync(rawJsonFiles);
      setRawJsonResult(data);
    } catch { setRawJsonResult(null); }
  }, [rawJsonFiles, rawJsonMut]);

  const handleRawJsonDirImport = useCallback(async () => {
    if (!rawJsonDir.trim()) return;
    try {
      const data = await rawJsonDirMut.mutateAsync(rawJsonDir.trim());
      setRawJsonResult(data);
    } catch { setRawJsonResult(null); }
  }, [rawJsonDir, rawJsonDirMut]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setColumnMapping({});
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleMappingChange = useCallback((field: string, colIdx: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (colIdx === '') {
        delete next[field];
      } else {
        next[field] = parseInt(colIdx, 10);
      }
      return next;
    });
  }, []);

  return (
    <>
      <div className="page-header">
        <h2>数据导入</h2>
        <small>导入 CSV / XLSX 数据包（兼容常见采集解析工具格式）</small>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">上传文件</div>
        <div className="card-body">
          {!file ? (
            <div
              className={`${s.uploadZone} ${dragOver ? s.dragOver : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              aria-label="上传数据包文件"
            >
              <svg className={s.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1={12} y1={3} x2={12} y2={15} />
              </svg>
              <div className={s.uploadText}>点击或拖拽文件到此处</div>
              <div className={s.uploadHint}>支持 CSV、XLSX 格式</div>
            </div>
          ) : (
            <div>
              <div className={s.fileName}>
                <span className={s.fileTag}>{file.name.split('.').pop()?.toUpperCase()}</span>
                {file.name}
                <span style={{ color: 'var(--gray-400)', fontSize: 12 }}>
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className={s.uploadInput}
                onChange={onInputChange}
                aria-label="选择文件"
              />
            </div>
          )}
          <input
            ref={!file ? fileRef : undefined}
            type="file"
            accept=".csv,.xlsx,.xls"
            className={s.uploadInput}
            onChange={onInputChange}
            aria-label="选择文件"
          />
        </div>
      </div>

      {previewMut.isPending && (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
            <span className="text-gray">正在解析文件...</span>
          </div>
        </div>
      )}

      {preview && !result && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">列映射（自动检测，可手动调整）</div>
            <div className="card-body">
              <div className={s.mappingGrid}>
                {Object.entries(FIELD_LABELS).map(([field, label]) => (
                  <div key={field} className={s.mappingRow}>
                    <span className={s.mappingLabel}>{label}</span>
                    <span className={s.mappingArrow}>←</span>
                    <select
                      className={s.mappingSelect}
                      value={columnMapping[field] ?? ''}
                      onChange={(e) => handleMappingChange(field, e.target.value)}
                      aria-label={`映射${label}列`}
                    >
                      <option value="">未映射</option>
                      {preview.headers.map((h, idx) => (
                        <option key={idx} value={idx}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">数据预览（前 {preview.rows.length} 行）</div>
            <div className={s.previewTable}>
              <table>
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} title={cell}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={s.btnRow}>
            <button
              className="btn btn-primary"
              disabled={importMut.isPending}
              onClick={handleImport}
              aria-label="确认导入数据"
            >
              {importMut.isPending ? '导入中...' : '确认导入'}
            </button>
            <button className="btn btn-outline" onClick={handleReset} aria-label="重新选择文件">
              重新选择
            </button>
          </div>
        </>
      )}

      {result && (
        <div className={`${s.resultBox} ${result.errors.length > 0 && result.imported === 0 ? s.error : s.success}`}>
          <div className={s.resultStat}>
            <div className={s.statItem}>
              <div className={s.statValue}>{result.total}</div>
              <div className={s.statLabel}>总行数</div>
            </div>
            <div className={s.statItem}>
              <div className={s.statValue} style={{ color: '#16a34a' }}>{result.imported}</div>
              <div className={s.statLabel}>成功导入</div>
            </div>
            <div className={s.statItem}>
              <div className={s.statValue} style={{ color: '#d97706' }}>{result.skipped}</div>
              <div className={s.statLabel}>跳过</div>
            </div>
            {result.errors.length > 0 && (
              <div className={s.statItem}>
                <div className={s.statValue} style={{ color: '#dc2626' }}>{result.errors.length}</div>
                <div className={s.statLabel}>错误</div>
              </div>
            )}
          </div>
          {result.errors.length > 0 && (
            <ul className={s.errorList}>
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className={s.btnRow}>
            <button className="btn btn-primary" onClick={handleReset} aria-label="继续导入更多文件">
              继续导入
            </button>
          </div>
        </div>
      )}
      {/* Raw JSON Import Section */}
      <div className="page-header" style={{ marginTop: 32 }}>
        <h2>数据导入</h2>
        <small>直接导入原始 JSON 文件（.txt/.json），自动提取完整商品数据</small>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">方式一：上传文件</div>
        <div className="card-body">
          <input
            ref={rawJsonRef}
            type="file"
            accept=".txt,.json"
            multiple
            className={s.uploadInput}
            onChange={(e) => handleRawJsonFiles(e.target.files)}
            aria-label="选择JSON文件"
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-outline"
              onClick={() => rawJsonRef.current?.click()}
            >
              选择文件
            </button>
            {rawJsonFiles.length > 0 && (
              <>
                <span style={{ color: 'var(--gray-500)', fontSize: 13 }}>
                  已选 {rawJsonFiles.length} 个文件
                </span>
                <button
                  className="btn btn-primary"
                  disabled={rawJsonMut.isPending}
                  onClick={handleRawJsonImport}
                >
                  {rawJsonMut.isPending ? '导入中...' : '开始导入'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">方式二：指定目录路径</div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={rawJsonDir}
              onChange={(e) => setRawJsonDir(e.target.value)}
              placeholder="输入数据目录路径，如 D:\数据目录"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 14 }}
            />
            <button
              className="btn btn-primary"
              disabled={rawJsonDirMut.isPending || !rawJsonDir.trim()}
              onClick={handleRawJsonDirImport}
            >
              {rawJsonDirMut.isPending ? '导入中...' : '导入目录'}
            </button>
          </div>
        </div>
      </div>

      {rawJsonResult && (
        <div className={`${s.resultBox} ${rawJsonResult.errors.length > 0 && rawJsonResult.imported === 0 ? s.error : s.success}`}>
          <div className={s.resultStat}>
            <div className={s.statItem}>
              <div className={s.statValue} style={{ color: '#16a34a' }}>{rawJsonResult.imported}</div>
              <div className={s.statLabel}>成功导入</div>
            </div>
            <div className={s.statItem}>
              <div className={s.statValue} style={{ color: '#d97706' }}>{rawJsonResult.skipped}</div>
              <div className={s.statLabel}>跳过(已存在)</div>
            </div>
            {rawJsonResult.errors.length > 0 && (
              <div className={s.statItem}>
                <div className={s.statValue} style={{ color: '#dc2626' }}>{rawJsonResult.errors.length}</div>
                <div className={s.statLabel}>错误</div>
              </div>
            )}
          </div>
          {rawJsonResult.errors.length > 0 && (
            <ul className={s.errorList}>
              {rawJsonResult.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className={s.btnRow}>
            <button className="btn btn-primary" onClick={() => { setRawJsonResult(null); setRawJsonFiles([]); setRawJsonDir(''); }}>
              继续导入
            </button>
          </div>
        </div>
      )}
    </>
  );
}
