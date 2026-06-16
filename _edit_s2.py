BASE = r"D:\jiexi\pdd_parser_1.1.22\frontend\src\pages"

# ============================================================
# Settings.tsx - add "确定改价" button
# ============================================================
p = BASE + r"\Settings.tsx"
with open(p, "r", encoding="utf-8") as f:
    c = f.read()

# 1. Add imports
c = c.replace(
    "import { useSettings, useSaveSettings, useTestApi } from '../hooks/useApi';",
    "import { useSettings, useSaveSettings, useTestApi, useBatchUpdate, useAllProductIds } from '../hooks/useApi';"
)

# 2. Add hook calls after existing hooks
c = c.replace(
    "  const { data: settings, isLoading } = useSettings();\n  const saveMut = useSaveSettings();\n  const testMut = useTestApi();\n  const toast = useToast();",
    "  const { data: settings, isLoading } = useSettings();\n  const saveMut = useSaveSettings();\n  const testMut = useTestApi();\n  const toast = useToast();\n  const batchMut = useBatchUpdate();\n  const { data: allIds } = useAllProductIds();"
)

# 3. Add "确定改价" button after the formula preview text
c = c.replace(
    "            <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: 0 }}>\n              公式：新价格 = 原价 x {priceMarkup.multiplier} + {priceMarkup.fixed_amount} 元\n            </p>\n          </div>\n        </div>\n\n        <div className=\"card\">\n          <div className=\"card-header\">风控检测</div>",
    "            <p style={{ fontSize: 12, color: 'var(--brand-text-muted)', margin: 0 }}>\n              公式：新价格 = 原价 x {priceMarkup.multiplier} + {priceMarkup.fixed_amount} 元\n            </p>\n            {priceMarkup.enabled && (\n              <button className=\"btn btn-primary\" style={{ alignSelf: 'flex-start', marginTop: 8 }}\n                onClick={async () => {\n                  if (!allIds || allIds.total === 0) { toast.error('没有商品可改价'); return; }\n                  try {\n                    const result = await batchMut.mutateAsync({\n                      ids: allIds.ids,\n                      updates: { price_multiply: priceMarkup.multiplier, price_add: priceMarkup.fixed_amount }\n                    });\n                    const skipped = (result as any)?.skipped || 0;\n                    if (skipped > 0) {\n                      toast.success(`已改价 ${allIds.total - skipped} 件商品，跳过 ${skipped} 件已改价商品`);\n                    } else {\n                      toast.success(`已改价 ${allIds.total} 件商品`);\n                    }\n                  } catch { toast.error('改价失败'); }\n                }}>\n                确定改价（全部 {allIds?.total || 0} 件商品）\n              </button>\n            )}\n          </div>\n        </div>\n\n        <div className=\"card\">\n          <div className=\"card-header\">风控检测</div>"
)

with open(p, "w", encoding="utf-8") as f:
    f.write(c)
print("OK: Settings.tsx")
