/** 对应后端数据结构 */

export interface SkuSpec {
  key: string;
  value: string;
}

export interface SkuItem {
  sku_id: string;
  price: number;
  original_price: number;
  stock: number;
  specs: SkuSpec[];
  image: string;
  barcode: string;
}

export interface GoodsInfo {
  goods_id: string;
  title: string;
  subtitle: string;
  selling_points: string[];
  price: number;
  original_price: number;
  min_group_price: number;
  sales: number;
  sold_quantity: number;
  shop_name: string;
  shop_id: string;
  shop_logo: string;
  main_images: string[];
  detail_images: string[];
  sku_images: string[];
  specs: Record<string, string[]>;
  skus: SkuItem[];
  description: string;
  attributes: Record<string, string>;
  source_url: string;
  crawl_time: string;
  price_modified?: number;
  tags?: TagInfo[];
  groups?: GroupInfo[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface DashboardStats {
  total_goods: number;
  today_goods: number;
  shop_count: number;
  recent: GoodsInfo[];
  shop_distribution: Record<string, number>;
}

export interface AutoTaskStatus {
  running: boolean;
  progress: number;
  total: number;
  message: string;
  logs: string[];
}

export type ExportFormat = 'excel' | 'txt' | 'dawang' | 'dawang_wechat' | 'dawang_pdd' | 'dawang_raw';

export interface TagInfo {
  id: number;
  name: string;
  color: string;
}

export interface GroupInfo {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order?: number;
}

export interface AiImage {
  id: number;
  source_url: string | null;
  prompt: string;
  result_path: string;
  model: string;
  created_at: string;
}

export interface WechatExportSettings {
  deliver_method?: number;
  seven_day_return?: number;
  freight_insurance?: number;
  default_stock?: number;
  brand_id?: number;
  listing?: number;
}

export interface SettingsData {
  image_api: {
    api_key?: string;
    api_key_masked?: string;
    api_key_set?: boolean;
    base_url: string;
    model: string;
  };
  text_api: {
    api_key?: string;
    api_key_masked?: string;
    api_key_set?: boolean;
    base_url: string;
    model: string;
  };
  proxy_url?: string;
  wechat_export?: WechatExportSettings;
  risk_monitor?: { enabled: boolean; interval: number };
  price_markup?: { enabled: boolean; multiplier: number; fixed_amount: number };
}

export interface DuplicateGroup {
  type: 'exact_id' | 'similar_title';
  goods_id?: string;
  title_prefix?: string;
  items: { goods_id: string; title: string }[];
}

export interface AiEditorProduct {
  goods_id: string;
  title: string;
  main_images: string[];
  detail_images: string[];
  sku_images: string[];
}

export interface AiHistoryItem {
  id: number;
  goods_id: string;
  source_url: string | null;
  prompt: string;
  result_path: string;
  model: string;
  created_at: string;
}

export interface CompareItem {
  goods_id: string;
  title: string;
  subtitle: string;
  selling_points: string[];
  price: number;
  original_price: number;
  min_group_price: number;
  sales: number;
  sold_quantity: number;
  shop_name: string;
  main_images: string[];
  detail_images: string[];
  specs: Record<string, string[]>;
  attributes: Record<string, string>;
}

export interface CopywritingRequest {
  goods_id: string;
  copy_type: 'title' | 'selling_points' | 'description' | 'all';
  style: string;
  custom_prompt?: string;
}

export interface CopywritingResult {
  title?: string;
  subtitle?: string;
  selling_points?: string[];
  description?: string;
}

export interface ExportTemplate {
  id: number;
  name: string;
  fields: string[];
  column_map: Record<string, string>;
  is_preset: boolean;
  created_at: string;
}

export interface MonitorItem {
  goods_id: string;
  title: string;
  main_images: string[];
  frequency: string;
  last_check: string | null;
  next_check: string | null;
  status: string;
  latest_price: number | null;
  latest_stock: number | null;
  latest_sales: number | null;
  price_change: number | null;
  stock_change: number | null;
  sales_change: number | null;
}

export interface MonitorHistoryPoint {
  checked_at: string;
  price: number | null;
  stock: number | null;
  sales: number | null;
}

export interface LogInfo {
  size: number;
  modified: string | null;
  exists: boolean;
}

export interface LogData {
  lines: string[];
  total: number;
  file: string;
}

export interface RiskCheckItem {
  goods_id: string;
  title: string;
  price: number;
  image: string;
}

export interface RiskCheckData {
  goods: RiskCheckItem[];
}
