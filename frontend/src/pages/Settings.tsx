import { useState, useEffect, useCallback } from 'react';
import { useSettings, useSaveSettings, useTestApi, useBatchUpdate, useAllProductIds } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import type { WechatExportSettings } from '../types';

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14, marginTop: 4, background: 'var(--brand-surface)',
};

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const saveMut = useSaveSettings();
  const testMut = useTestApi();
  const toast = useToast();
  const batchMut = useBatchUpdate();
  const { data: allIds } = useAllProductIds();

  const [imgKey, setImgKey] = useState('');
  const [imgBase, setImgBase] = useState('https://grsai.dakka.com.cn');
  const [imgModel, setImgModel] = useState('gpt-image-2');
  const [txtKey, setTxtKey] = useState('');
  const [txtBase, setTxtBase] = useState('https://token-plan-cn.xiaomimimo.com/v1');
  const [txtModel, setTxtModel] = useState('mimo-v2.5');

  const [wechatCfg, setWechatCfg] = useState<WechatExportSettings>({
    deliver_method: 0,
    seven_day_return: 1,
    freight_insurance: 0,
    default_stock: 999,
    brand_id: 2100000000,
    listing: 0,
  });

  const [imgTestResult, setImgTestResult] = useState('');
  const [txtTestResult, setTxtTestResult] = useState('');
  const [riskMonitor, setRiskMonitor] = useState({ enabled: false, interval: 30 });
  const [priceMarkup, setPriceMarkup] = useState({ enabled: false, multiplier: 1.5, fixed_amount: 3.0 });
  const [saving, setSaving] = useState(false);
  const [imgKeySet, setImgKeySet] = useState(false);
  const [imgKeyMasked, setImgKeyMasked] = useState('');
  const [txtKeySet, setTxtKeySet] = useState(false);
  const [txtKeyMasked, setTxtKeyMasked] = useState('');

  useEffect(() => {
    if (settings) {
      if (settings.image_api) {
        setImgBase(settings.image_api.base_url || '');
        setImgModel(settings.image_api.model || '');
        setImgKeySet(!!settings.image_api.api_key_set);
        setImgKeyMasked(settings.image_api.api_key_masked || '');
      }
      if (settings.text_api) {
        setTxtBase(settings.text_api.base_url || '');
        setTxtModel(settings.text_api.model || '');
        setTxtKeySet(!!settings.text_api.api_key_set);
        setTxtKeyMasked(settings.text_api.api_key_masked || '');
      }
      if (settings.wechat_export) {
        setWechatCfg(prev => ({ ...prev, ...settings.wechat_export }));
      }
      if (settings.risk_monitor) {
        setRiskMonitor(prev => ({ ...prev, ...settings.risk_monitor }));
      }
      if (settings.price_markup) {
        setPriceMarkup(prev => ({ ...prev, ...settings.price_markup }));
      }
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (imgKey || imgBase || imgModel) {
        payload.image_api = { base_url: imgBase, model: imgModel };
        if (imgKey) (payload.image_api as Record<string, unknown>).api_key = imgKey;
      }
      if (txtKey || txtBase || txtModel) {
        payload.text_api = { base_url: txtBase, model: txtModel };
        if (txtKey) (payload.text_api as Record<string, unknown>).api_key = txtKey;
      }
      payload.wechat_export = wechatCfg;
      payload.risk_monitor = riskMonitor;
      payload.price_markup = priceMarkup;
      await saveMut.mutateAsync(payload);
      if (imgKey) {
        const len = imgKey.length;
        setImgKeySet(true);
        setImgKeyMasked(len > 8 ? imgKey.slice(0, 4) + '****' + imgKey.slice(-4) : '');
        setImgKey('');
      }
      if (txtKey) {
        const len = txtKey.length;
        setTxtKeySet(true);
        setTxtKeyMasked(len > 8 ? txtKey.slice(0, 4) + '****' + txtKey.slice(-4) : '');
        setTxtKey('');
      }
      toast.success('保存成功');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [imgKey, imgBase, imgModel, txtKey, txtBase, txtModel, wechatCfg, riskMonitor, saveMut]);

  const handleTest = useCallback(async (type: 'text' | 'image') => {
    const params = type === 'image'
      ? { api_key: imgKey || undefined, base_url: imgBase, model: imgModel }
      : { api_key: txtKey || undefined, base_url: txtBase, model: txtModel };
    try {
      const r = await testMut.mutateAsync({ type, ...params });
      const msg = r.ok ? `连接成功 (${r.model})` : `连接失败: ${r.error}`;
      if (type === 'text') setTxtTestResult(msg); else setImgTestResult(msg);
    } catch {
      if (type === 'text') setTxtTestResult('测试失败'); else setImgTestResult('测试失败');
    }
  }, [testMut, imgKey, imgBase, imgModel, txtKey, txtBase, txtModel]);

  const updateWechat = useCallback((key: keyof WechatExportSettings, value: number) => {
    setWechatCfg(prev => ({ ...prev, [key]: value }));
  }, []);

  if (isLoading) return <div className="page-header"><h2>设置</h2><p>加载中...</p></div>;

  return (
    <>
      <div className="page-header">
        <h2>设置</h2>
        <small>配置 AI 模型 API、微信小店导出参数和系统设置</small>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>图片模型 API（AI 图片编辑/生成）</span>
            <button className="btn btn-outline btn-sm" onClick={() => { setImgKey(''); setImgBase(''); setImgModel(''); }}>清空配置</button>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--brand-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              配置用于 AI 图片编辑和生成的模型接口，支持兼容 OpenAI 格式的 API 服务。
            </p>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>API Key {imgKeySet ? <span style={{color:'var(--brand-green)'}}>(已配置: {imgKeyMasked})</span> : <span style={{color:'var(--brand-red)'}}>(未配置)</span>}</label>
              <input type="password" value={imgKey} onChange={e => setImgKey(e.target.value)} placeholder="输入新的 API Key（留空不修改）" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>Base URL</label>
              <input value={imgBase} onChange={e => setImgBase(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>模型名称</label>
              <input value={imgModel} onChange={e => setImgModel(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={() => handleTest('image')}>测试连接</button>
              {imgTestResult && <span style={{ fontSize: 13, color: imgTestResult.includes('成功') ? 'var(--brand-green)' : 'var(--brand-red)' }}>{imgTestResult}</span>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>文本模型 API（AI 文案改写）</span>
            <button className="btn btn-outline btn-sm" onClick={() => { setTxtKey(''); setTxtBase(''); setTxtModel(''); }}>清空配置</button>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--brand-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              配置用于 AI 文案改写的语言模型接口，支持兼容 OpenAI 格式的 API 服务。
            </p>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>API Key {txtKeySet ? <span style={{color:'var(--brand-green)'}}>(已配置: {txtKeyMasked})</span> : <span style={{color:'var(--brand-red)'}}>(未配置)</span>}</label>
              <input type="password" value={txtKey} onChange={e => setTxtKey(e.target.value)} placeholder="输入新的 API Key（留空不修改）" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>Base URL</label>
              <input value={txtBase} onChange={e => setTxtBase(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>模型名称</label>
              <input value={txtModel} onChange={e => setTxtModel(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-outline btn-sm" onClick={() => handleTest('text')}>测试连接</button>
              {txtTestResult && <span style={{ fontSize: 13, color: txtTestResult.includes('成功') ? 'var(--brand-green)' : 'var(--brand-red)' }}>{txtTestResult}</span>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">微信小店导出设置</div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--brand-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              配置导出到微信小店时的默认商品属性参数。
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>发货方式</label>
                <select value={wechatCfg.deliver_method ?? 0} onChange={e => updateWechat('deliver_method', Number(e.target.value))} style={selectStyle}>
                  <option value={0}>快递发货</option>
                  <option value={1}>无需快递</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>七天无理由退换</label>
                <select value={wechatCfg.seven_day_return ?? 1} onChange={e => updateWechat('seven_day_return', Number(e.target.value))} style={selectStyle}>
                  <option value={1}>是</option>
                  <option value={0}>否</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>运费险</label>
                <select value={wechatCfg.freight_insurance ?? 0} onChange={e => updateWechat('freight_insurance', Number(e.target.value))} style={selectStyle}>
                  <option value={0}>关闭</option>
                  <option value={1}>开启</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>默认库存</label>
                <input type="number" value={wechatCfg.default_stock ?? 999} onChange={e => updateWechat('default_stock', Number(e.target.value))} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>品牌ID</label>
                <input value={String(wechatCfg.brand_id ?? '2100000000')} onChange={e => setWechatCfg(prev => ({ ...prev, brand_id: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>上架状态</label>
                <select value={wechatCfg.listing ?? 0} onChange={e => updateWechat('listing', Number(e.target.value))} style={selectStyle}>
                  <option value={0}>放入仓库</option>
                  <option value={1}>立即上架</option>
                </select>
              </div>

            </div>
            <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: 0 }}>
              以上参数在导出"微信小店"格式时生效，控制导出数据包的默认商品属性。
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">批量改价公式</div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--brand-text-secondary)', margin: 0 }}>
              设置默认改价公式，商品详情页和列表页的「批量改价」按钮将使用此公式。
            </p>
            <label style={{ fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={priceMarkup.enabled}
                onChange={e => setPriceMarkup(prev => ({ ...prev, enabled: e.target.checked }))}
                style={{ width: 16, height: 16 }} />
              启用改价公式
            </label>
            {priceMarkup.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>倍率</label>
                  <input type="number" step="0.01" min="0.01" value={priceMarkup.multiplier}
                    onChange={e => setPriceMarkup(prev => ({ ...prev, multiplier: parseFloat(e.target.value) || 1 }))}
                    style={{ width: 80, padding: '8px 12px', border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14, marginTop: 4, background: 'var(--brand-surface)' }} />
                </div>
                <span style={{ fontSize: 16, marginTop: 16 }}>x</span>
                <span style={{ fontSize: 13, color: 'var(--brand-text-muted)', marginTop: 16 }}>原价 +</span>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>附加金额</label>
                  <input type="number" step="0.01" value={priceMarkup.fixed_amount}
                    onChange={e => setPriceMarkup(prev => ({ ...prev, fixed_amount: parseFloat(e.target.value) || 0 }))}
                    style={{ width: 80, padding: '8px 12px', border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14, marginTop: 4, background: 'var(--brand-surface)' }} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--brand-text-muted)', marginTop: 16 }}>元</span>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: 0 }}>
              公式：新价格 = 原价 x {priceMarkup.multiplier} + {priceMarkup.fixed_amount} 元
            </p>
            {priceMarkup.enabled && (
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: 8 }}
                onClick={async () => {
                  if (!allIds || allIds.total === 0) { toast.error('没有商品可改价'); return; }
                  try {
                    const result = await batchMut.mutateAsync({
                      ids: allIds.ids,
                      updates: { price_multiply: priceMarkup.multiplier, price_add: priceMarkup.fixed_amount }
                    });
                    const skipped = (result as any)?.skipped || 0;
                    if (skipped > 0) {
                      toast.success(`已改价 ${allIds.total - skipped} 件商品，跳过 ${skipped} 件已改价商品`);
                    } else {
                      toast.success(`已改价 ${allIds.total} 件商品`);
                    }
                  } catch { toast.error('改价失败'); }
                }}>
                确定改价（全部 {allIds?.total || 0} 件商品）
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">风控检测</div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--brand-text-secondary)', margin: 0, lineHeight: 1.5 }}>
              定期扫描商品列表中缺少 SKU 信息的商品，可能是拼多多账号被风控导致。
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={riskMonitor.enabled}
                  onChange={e => setRiskMonitor(prev => ({ ...prev, enabled: e.target.checked }))}
                  style={{ width: 16, height: 16 }}
                />
                启用风控检测
              </label>
            </div>
            {riskMonitor.enabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'var(--brand-text-secondary)' }}>扫描间隔</label>
                <input
                  type="number"
                  min={3}
                  max={300}
                  value={riskMonitor.interval}
                  onChange={e => setRiskMonitor(prev => ({ ...prev, interval: Math.max(3, Number(e.target.value) || 30) }))}
                  style={{ ...inputStyle, width: 80, marginTop: 0 }}
                />
                <span style={{ fontSize: 13, color: 'var(--brand-text-muted)' }}>秒</span>
              </div>
            )}
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14, marginTop: 4,
};
