BASE = r"D:\jiexi\pdd_parser_1.1.22\frontend\src\pages"

# ============================================================
# ProductDetail.tsx - insert batch price modal before AI edit modal
# ============================================================
p = BASE + r"\ProductDetail.tsx"
with open(p, "r", encoding="utf-8") as f:
    c = f.read()

# Insert batch price modal before the aiEditModal section
old = "      {aiEditModal.open && ("
new = """      {/* Batch Price Modal */}
      {showBatchPrice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowBatchPrice(false)}>
          <div style={{ background: 'var(--brand-surface)', borderRadius: 12, padding: 24, minWidth: 320, maxWidth: 400, position: 'relative' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>批量改价（{product?.skus?.length || product?.sku_items?.length || 0} 个SKU）</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>倍率（如 1.5 表示加价 50%）</label>
                <input type="number" step="0.01" value={batchMultiplier} onChange={e => setBatchMultiplier(parseFloat(e.target.value) || 1)}
                  style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brand-text-secondary)' }}>附加金额（元）</label>
                <input type="number" step="0.01" value={batchFixedAmount} onChange={e => setBatchFixedAmount(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: 8, border: '1px solid var(--brand-border)', borderRadius: 6, fontSize: 14 }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: 0 }}>新价格 = 原价 x {batchMultiplier} + {batchFixedAmount} 元</p>
              <button className="btn btn-primary" disabled={batchPriceMut.isPending} onClick={async () => {
                try {
                  if (!product) return;
                  await batchPriceMut.mutateAsync({ goodsId: product.goods_id, multiplier: batchMultiplier, fixedAmount: batchFixedAmount });
                  setShowBatchPrice(false);
                  alert('改价成功');
                } catch { alert('改价失败'); }
              }}>{batchPriceMut.isPending ? '处理中...' : '确认改价'}</button>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              onClick={() => setShowBatchPrice(false)}>x</button>
          </div>
        </div>
      )}

      {aiEditModal.open && ("""

c = c.replace(old, new, 1)

with open(p, "w", encoding="utf-8") as f:
    f.write(c)
print("OK: ProductDetail.tsx")
