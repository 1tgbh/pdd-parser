export const FIELD_LABELS: Record<string, string> = {
  goods_id: '商品ID', title: '标题', subtitle: '副标题', description: '描述', price: '价格', original_price: '原价',
  min_group_price: '拼团价', sales: '销量', sold_quantity: '已售数量', shop_name: '店铺', shop_id: '店铺ID', shop_logo: '店铺图',
  main_images: '主图', detail_images: '详情图', sku_images: 'SKU图', specs: '规格', skus: 'SKU', attributes: '属性',
  selling_points: '卖点', price_min: '最低价格', price_max: '最高价格', total_stock: '总库存', stock: '库存', image: '图片',
};
export const ORIGIN_LABELS: Record<string, string> = {
  page_state: '页面结构化字段', dom: '页面DOM', derived: '计算／合并值', import: '本地导入', manual: '人工编辑',
  unknown: '未获取', legacy: '历史来源未记录', provided: '输入字段（原位置未验证）',
};
export const STAGE_LABELS: Record<string, string> = {
  page_read: '页面读取', preview: '预览确认', sync: '本地同步', image: '图片读取', export: '导出', import: '导入', edit: '人工编辑',
};

export function evidenceValue(value: unknown, status?: string) {
  if (status === 'unknown') return '未获取';
  if (value == null) return '未知';
  if (typeof value === 'string') return value || '空值';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function evidenceTime(value?: string | null) {
  if (!value) return '未记录';
  const normalized = value.replace(' ', 'T');
  const time = new Date(normalized);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}
