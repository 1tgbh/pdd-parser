import axios from 'axios';import type {  GoodsInfo, PaginatedResponse, DashboardStats, AutoTaskStatus,  ExportFormat, TagInfo, GroupInfo, AiImage, SettingsData, DuplicateGroup,  AiEditorProduct, AiHistoryItem, CompareItem, CopywritingResult,  ExportTemplate, MonitorItem, MonitorHistoryPoint, SkuItem,  ImportPreview, ImportResult, LogInfo, LogData, RiskCheckData,} from '../types';const client = axios.create({ baseURL: '/api', timeout: 15000 });const aiClient = axios.create({ baseURL: '/api', timeout: 120000 });// Dashboard
export async function fetchDashboard(): Promise<DashboardStats> {  const { data } = await client.get('/dashboard');  return data;}
export async function fetchPriceDistribution() {  const { data } = await client.get('/dashboard/price-distribution');  return data;}
export async function fetchTopSales() {  const { data } = await client.get('/dashboard/top-sales');  return data;}
export async function fetchTagStats() {  const { data } = await client.get('/dashboard/tag-stats');  return data;}
export async function fetchPriceAlerts() {  const { data } = await client.get('/dashboard/price-alerts');  return data;}// Products
export async function fetchProducts(  page = 1, pageSize = 20, keyword = '', tagId?: number, groupId?: number,  filters?: { min_price?: string; max_price?: string; min_sales?: string; max_sales?: string; shop?: string },): Promise<PaginatedResponse<GoodsInfo>> {  const params: Record<string, unknown> = { page, page_size: pageSize, keyword };  if (tagId) params.tag = tagId;  if (groupId) params.group = groupId;  if (filters?.min_price) params.min_price = filters.min_price;  if (filters?.max_price) params.max_price = filters.max_price;  if (filters?.min_sales) params.min_sales = filters.min_sales;  if (filters?.max_sales) params.max_sales = filters.max_sales;  if (filters?.shop) params.shop = filters.shop;  const { data } = await client.get('/products', { params });  return data;}
export async function fetchProduct(id: string): Promise<GoodsInfo> {  const { data } = await client.get(`/product/${id}`);  return data;}
export async function fetchProductSkus(goodsId: string): Promise<{ skus: import('../types').SkuItem[] }> {  const { data } = await client.get(`/product/${goodsId}`);  return { skus: data.skus || [] };}
export async function fetchCaptureToggle(): Promise<{ enabled: boolean }> {
  const { data } = await client.get('/capture-toggle');
  return data;
}
export async function setCaptureToggle(enabled: boolean): Promise<{ enabled: boolean }> {
  const { data } = await client.post('/capture-toggle', { enabled });
  return data;
}
export async function fetchProductIds(keyword = ''): Promise<{ ids: string[]; total: number }> {
  const { data } = await client.get('/product-ids', { params: { keyword } });
  return data;
}
export async function deleteProduct(id: string): Promise<{ ok: boolean }> {  const { data } = await client.delete(`/product/${id}`);  return data;}
export async function deleteProducts(ids: string[]): Promise<{ ok: boolean; deleted_count: number }> {  const { data } = await client.post('/products/delete', { ids });  return data;}
export async function updateProduct(id: string, fields: Record<string, unknown>): Promise<GoodsInfo> {  const { data } = await client.put(`/product/${id}`, fields);  return data;}// Auto task
export async function startAutoTask(keyword: string, maxPages: number): Promise<{ ok: boolean }> {  const { data } = await client.post('/auto/start', { keyword, max_pages: maxPages });  return data;}
export async function stopAutoTask(): Promise<{ ok: boolean }> {  const { data } = await client.post('/auto/stop');  return data;}
export async function fetchAutoStatus(): Promise<AutoTaskStatus> {  const { data } = await client.get('/auto/status');  return data;}// Export
export async function exportGoods(ids: string[], format: ExportFormat, templateId?: number): Promise<Blob> {  const payload: Record<string, unknown> = { ids, format };  if (templateId) payload.template_id = templateId;  const { data, headers } = await client.post('/export', payload, { responseType: 'blob' });  if (data.type === 'application/json') {    const text = await data.text();    const err = JSON.parse(text);    throw new Error(err.error || 'Export failed');  }  return data;}
export async function packageGoods(ids: string[], includeImages: boolean): Promise<Blob> {  const { data, headers } = await client.post('/package', { ids, include_images: includeImages }, { responseType: 'blob' });  if (data.type === 'application/json') {    const text = await data.text();    const err = JSON.parse(text);    throw new Error(err.error || 'Package failed');  }  return data;}// Settings
export async function fetchSettings(): Promise<SettingsData> {  const { data } = await client.get('/settings');  return data;}
export async function saveSettings(settings: Record<string, unknown>): Promise<{ ok: boolean }> {  const { data } = await client.put('/settings', settings);  return data;}
export async function testApi(type: 'text' | 'image', params?: { api_key?: string; base_url?: string; model?: string }): Promise<{ ok: boolean; error?: string; model?: string }> {  const { data } = await client.post('/settings/test', { type, ...params });  return data;}// Tags
export async function fetchTags(): Promise<TagInfo[]> {  const { data } = await client.get('/tags');  return data;}
export async function createTag(name: string, color: string): Promise<TagInfo> {  const { data } = await client.post('/tags', { name, color });  return data;}
export async function updateTag(id: number, fields: Partial<TagInfo>): Promise<{ ok: boolean }> {  const { data } = await client.put(`/tags/${id}`, fields);  return data;}
export async function deleteTag(id: number): Promise<{ ok: boolean }> {  const { data } = await client.delete(`/tags/${id}`);  return data;}
export async function fetchProductTags(goodsId: string): Promise<TagInfo[]> {  const { data } = await client.get(`/product/${goodsId}/tags`);  return data;}
export async function setProductTags(goodsId: string, tagIds: number[], remove = false): Promise<{ ok: boolean }> {  const { data } = remove    ? await client.delete(`/product/${goodsId}/tags`, { data: { tag_ids: tagIds } })    : await client.post(`/product/${goodsId}/tags`, { tag_ids: tagIds });  return data;}// Groups
export async function fetchGroups(): Promise<GroupInfo[]> {  const { data } = await client.get('/groups');  return data;}
export async function createGroup(name: string, parentId?: number): Promise<GroupInfo> {  const { data } = await client.post('/groups', { name, parent_id: parentId });  return data;}
export async function updateGroup(id: number, fields: Partial<GroupInfo>): Promise<{ ok: boolean }> {  const { data } = await client.put(`/groups/${id}`, fields);  return data;}
export async function deleteGroup(id: number): Promise<{ ok: boolean }> {  const { data } = await client.delete(`/groups/${id}`);  return data;}// Batch
export async function batchUpdate(ids: string[], updates: Record<string, unknown>): Promise<{ ok: boolean; updated: number }

export async function batchPriceSingle(
  goodsId: string, multiplier: number, fixedAmount: number
): Promise<{ ok: boolean; price: number; skus_count: number }> {
  const { data } = await client.post(`/product/${goodsId}/batch-price`, {
    multiplier, fixed_amount: fixedAmount,
  });
  return data;
}
> {  const { data } = await client.post('/products/batch-update', { ids, updates });  return data;}// AI
export async function fetchAiPresets(): Promise<Record<string, string>> {  const { data } = await client.get('/ai/presets');  return data;}
export async function aiGenerateImage(prompt: string, goodsId: string, size?: string): Promise<{ paths?: string[]; error?: string }> {  const { data } = await aiClient.post('/ai/generate-image', { prompt, goods_id: goodsId, size });  return data;}
export async function aiEditImage(imageUrl: string, prompt: string, goodsId: string, preset?: string, size?: string): Promise<{ paths?: string[]; urls?: string[]; error?: string }> {  const { data } = await aiClient.post('/ai/edit-image', { image_url: imageUrl, prompt, goods_id: goodsId, preset, size });  return data;}
export async function aiUseImage(goodsId: string, imagePath: string, target: 'main' | 'detail'): Promise<{ ok: boolean; images: string[] }> {  const { data } = await client.post('/ai/use-image', { goods_id: goodsId, image_path: imagePath, target });  return data;}
export async function fetchProductAiImages(goodsId: string): Promise<AiImage[]> {  const { data } = await client.get(`/product/${goodsId}/ai-images`);  return data;}
export async function aiRewrite(goodsId: string, targets?: string[], style?: string, customPrompt?: string): Promise<{ result?: Record<string, unknown>; error?: string }> {  const { data } = await aiClient.post('/ai/rewrite', { goods_id: goodsId, targets, style, custom_prompt: customPrompt });  return data;}
export async function removeBackground(imageUrl: string): Promise<string> {  const { data } = await aiClient.post('/ai/remove-bg', { image_url: imageUrl });  return data.url;}
export async function proxyImage(url: string): Promise<{ ok: boolean; url: string }> {  const { data } = await client.get('/proxy-image', { params: { url }, timeout: 30000 });  return data;}
export async function uploadEditorImage(file: File): Promise<{ ok: boolean; url: string }> {  const form = new FormData();  form.append('file', file);  const { data } = await client.post('/ai/upload-image', form, {    headers: { 'Content-Type': 'multipart/form-data' },    timeout: 60000,  });  return data;}
export async function searchProductsForEditor(keyword: string, tag?: string, group?: string): Promise<{ items: AiEditorProduct[]; total: number }> {  const params: Record<string, string> = {};  if (keyword) params.keyword = keyword;  if (tag) params.tag = tag;  if (group) params.group = group;  params.page_size = '50';  const { data } = await client.get('/products/search', { params });  return data;}
export async function fetchAiHistory(page = 1, pageSize = 20): Promise<{ items: AiHistoryItem[]; total: number }> {  const { data } = await client.get('/ai/history', { params: { page, page_size: pageSize } });  return data;}
export async function deleteAiHistory(ids: number[]): Promise<{ ok: boolean; deleted_count: number }> {  const { data } = await client.delete('/ai/history', { data: { ids } });  return data;}// Image management
export async function uploadImage(goodsId: string, file: File, target: 'main' | 'detail'): Promise<{ ok: boolean; url: string; images: string[] }> {  const form = new FormData();  form.append('file', file);  form.append('target', target);  const { data } = await client.post(`/product/${goodsId}/images/upload`, form, {    headers: { 'Content-Type': 'multipart/form-data' },    timeout: 60000,  });  return data;}
export async function reorderImages(goodsId: string, target: 'main' | 'detail', order: string[]): Promise<{ ok: boolean }> {  const { data } = await client.put(`/product/${goodsId}/images/reorder`, { target, order });  return data;}// Compare
export async function fetchCompare(goodsIds: string[]): Promise<CompareItem[]> {  const { data } = await client.post('/compare', { goods_ids: goodsIds });  return data;}// Duplicates
export async function fetchDuplicates(): Promise<{ duplicates: DuplicateGroup[]; total_groups: number }> {  const { data } = await client.get('/products/duplicates');  return data;}// Copywriting
export async function aiCopywriting(goodsId: string, copyType: string, style: string, customPrompt?: string): Promise<AiCopywritingResult> {  const { data } = await aiClient.post('/ai/copywriting', { goods_id: goodsId, copy_type: copyType, style, custom_prompt: customPrompt });  return data;}
export async function aiSuggestPrompt(imageUrl: string): Promise<{ prompt: string }> {  const { data } = await aiClient.post('/ai/suggest-prompt', { image_url: imageUrl });  return data;}
export async function applyCopywriting(goodsId: string, fields: Record<string, unknown>): Promise<{ ok: boolean }> {  const { data } = await client.post(`/product/${goodsId}/copywriting`, { fields });  return data;}// Export Templates
export async function fetchExportTemplates(): Promise<ExportTemplate[]> {  const { data } = await client.get('/export-templates');  return data;}
export async function createExportTemplate(name: string, fields: string[], columnMap: Record<string, string>): Promise<{ ok: boolean; id: number }> {  const { data } = await client.post('/export-templates', { name, fields, column_map: columnMap });  return data;}
export async function updateExportTemplate(id: number, name: string, fields: string[], columnMap: Record<string, string>): Promise<{ ok: boolean }> {  const { data } = await client.put(`/export-templates/${id}`, { name, fields, column_map: columnMap });  return data;}
export async function deleteExportTemplate(id: number): Promise<{ ok: boolean }> {  const { data } = await client.delete(`/export-templates/${id}`);  return data;}// Monitor
export async function fetchMonitorList(): Promise<MonitorItem[]> {  const { data } = await client.get('/monitor');  return data;}
export async function addMonitor(goodsId: string, frequency: string): Promise<{ ok: boolean }> {  const { data } = await client.post('/monitor', { goods_id: goodsId, frequency });  return data;}
export async function removeMonitor(goodsId: string): Promise<{ ok: boolean }> {  const { data } = await client.delete(`/monitor/${goodsId}`);  return data;}
export async function updateMonitorFrequency(goodsId: string, frequency: string): Promise<{ ok: boolean }> {  const { data } = await client.put(`/monitor/${goodsId}/frequency`, { frequency });  return data;}
export async function fetchMonitorHistory(goodsId: string): Promise<MonitorHistoryPoint[]> {  const { data } = await client.get(`/monitor/${goodsId}/history`);  return data;}
export async function refreshMonitor(): Promise<{ ok: boolean; updated: number }> {  const { data } = await client.post('/monitor/refresh');  return data;}// Import
export async function previewImport(file: File): Promise<ImportPreview> {  const form = new FormData();  form.append('file', file);  const { data } = await client.post('/import/preview', form, {    headers: { 'Content-Type': 'multipart/form-data' },    timeout: 30000,  });  return data;}
export async function importData(file: File, columnMapping?: Record<string, number>): Promise<ImportResult> {  const form = new FormData();  form.append('file', file);  if (columnMapping) {    form.append('column_mapping', JSON.stringify(columnMapping));  }  const { data } = await client.post('/import', form, {    headers: { 'Content-Type': 'multipart/form-data' },    timeout: 60000,  });  return data;}

export async function importRawJson(files: File[]): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const form = new FormData();
  files.forEach(f => form.append("files", f));
  const { data } = await client.post("/import-raw-json", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
  return data;
}


export async function importRawJsonDir(directory: string): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const form = new FormData();
  form.append("directory", directory);
  const { data } = await client.post("/import-raw-json", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  });
  return data;
}

export async function fetchLogs(type: string, page = 1, pageSize = 200): Promise<LogData> {
  const { data } = await client.get('/logs', { params: { type, page, page_size: pageSize } });
  return data;
}

export async function fetchLogInfo(): Promise<Record<string, LogInfo>> {
  const { data } = await client.get('/logs/info');
  return data;
}

export async function exportLogs(type: string): Promise<Blob> {
  const { data } = await client.get('/logs/export', {
    params: { type },
    responseType: 'blob',
  });
  return data;
}

export async function fetchRiskCheck(): Promise<RiskCheckData> {
  const { data } = await client.get('/risk-check');
  return data;
}

export async function fetchShops(): Promise<{ shops: string[] }> {
  const { data } = await client.get('/shops');
  return data;
}

export async function dismissRiskCheck(): Promise<{ ok: boolean }> {
  const { data } = await client.post('/risk-check/dismiss');
  return data;
}
