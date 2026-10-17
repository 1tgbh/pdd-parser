import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchDashboard, fetchPriceDistribution, fetchTopSales, fetchTagStats, fetchPriceAlerts,
  fetchProducts, fetchProduct,
  exportGoods, packageGoods, deleteProduct, deleteProducts, updateProduct,
  fetchSettings, saveSettings, testApi,
  fetchTags, createTag, deleteTag, fetchProductTags, setProductTags,
  fetchGroups, createGroup, deleteGroup,
  batchUpdate,
  batchPriceSingle,
  fetchAiPresets, aiGenerateImage, aiEditImage, aiUseImage, fetchProductAiImages, aiRewrite,
  uploadEditorImage, searchProductsForEditor, fetchAiHistory, deleteAiHistory, removeBackground,
  uploadImage, reorderImages,
  fetchDuplicates,
  aiCopywriting, applyCopywriting, aiSuggestPrompt,
  fetchExportTemplates,
  fetchMonitorList, addMonitor, removeMonitor,
  fetchMonitorHistory, refreshMonitor, fetchProductSkus,
  previewImport, importData, importRawJson, importRawJsonDir,
  fetchLogs, fetchLogInfo, exportLogs,
  fetchRiskCheck, dismissRiskCheck, fetchShops,
  fetchProductIds,
  fetchCaptureToggle, setCaptureToggle,
} from '../api';
import type { ExportFormat } from '../types';

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });
}

export function usePriceDistribution() {
  return useQuery({ queryKey: ['priceDistribution'], queryFn: fetchPriceDistribution });
}

export function useTopSales() {
  return useQuery({ queryKey: ['topSales'], queryFn: fetchTopSales });
}

export function useTagStats() {
  return useQuery({ queryKey: ['tagStats'], queryFn: fetchTagStats });
}

export function usePriceAlerts() {
  return useQuery({ queryKey: ['priceAlerts'], queryFn: fetchPriceAlerts, refetchInterval: 60000 });
}

export function useProducts(
  page: number, keyword: string, tagId?: number, groupId?: number,
  filters?: { min_price?: string; max_price?: string; min_sales?: string; max_sales?: string; shop?: string },
) {
  const query = useQuery({
    queryKey: ['products', page, keyword, tagId, groupId, filters],
    queryFn: () => fetchProducts(page, 20, keyword, tagId, groupId, filters),
  });
  const state = query.isLoading ? 'loading' : !query.data || query.data.items.length === 0 ? 'empty' : 'ready';
  return { ...query, state };
}

export function useProduct(id: string | undefined) {
  return useQuery({ queryKey: ['product', id], queryFn: () => fetchProduct(id!), enabled: !!id });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useDeleteProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => deleteProducts(ids),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Record<string, unknown> }) => updateProduct(id, fields),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', v.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useExportGoods() {
  return useMutation({
    mutationFn: ({ ids, format, templateId }: { ids: string[]; format: ExportFormat; templateId?: number }) => exportGoods(ids, format, templateId),
  });
}

export function usePackageGoods() {
  return useMutation({
    mutationFn: ({ ids, includeImages }: { ids: string[]; includeImages: boolean }) => packageGoods(ids, includeImages),
  });
}

// Settings
export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, unknown>) => saveSettings(settings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useTestApi() {
  return useMutation({
    mutationFn: (params: { type: 'text' | 'image'; api_key?: string; base_url?: string; model?: string }) =>
      testApi(params.type, { api_key: params.api_key, base_url: params.base_url, model: params.model }),
  });
}

// Tags
export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: fetchTags });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => createTag(name, color),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useProductTags(goodsId: string | undefined) {
  return useQuery({ queryKey: ['productTags', goodsId], queryFn: () => fetchProductTags(goodsId!), enabled: !!goodsId });
}

export function useSetProductTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, tagIds, remove }: { goodsId: string; tagIds: number[]; remove?: boolean }) =>
      setProductTags(goodsId, tagIds, remove),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['productTags', v.goodsId] });
      qc.invalidateQueries({ queryKey: ['product', v.goodsId] });
    },
  });
}

// Groups
export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: fetchGroups });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: number }) => createGroup(name, parentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

// Batch
export function useBatchUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, updates }: { ids: string[]; updates: Record<string, unknown> }) => batchUpdate(ids, updates),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}



export function useBatchPriceSingle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, multiplier, fixedAmount }: {
      goodsId: string; multiplier: number; fixedAmount: number;
    }) => batchPriceSingle(goodsId, multiplier, fixedAmount),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['product', v.goodsId] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
// AI
export function useAiPresets() {
  return useQuery({ queryKey: ['aiPresets'], queryFn: fetchAiPresets });
}

export function useAiGenerateImage() {
  return useMutation({
    mutationFn: ({ prompt, goodsId, size }: { prompt: string; goodsId: string; size?: string }) =>
      aiGenerateImage(prompt, goodsId, size),
  });
}

export function useAiEditImage() {
  return useMutation({
    mutationFn: ({ imageUrl, prompt, goodsId, preset, size }: { imageUrl: string; prompt: string; goodsId: string; preset?: string; size?: string }) =>
      aiEditImage(imageUrl, prompt, goodsId, preset, size),
  });
}

export function useAiUseImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, imagePath, target }: { goodsId: string; imagePath: string; target: 'main' | 'detail' }) =>
      aiUseImage(goodsId, imagePath, target),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['product', v.goodsId] });
      qc.invalidateQueries({ queryKey: ['productAiImages', v.goodsId] });
    },
  });
}

export function useProductAiImages(goodsId: string | undefined) {
  return useQuery({ queryKey: ['productAiImages', goodsId], queryFn: () => fetchProductAiImages(goodsId!), enabled: !!goodsId });
}

export function useAiRewrite() {
  return useMutation({
    mutationFn: ({ goodsId, targets, style, customPrompt }: { goodsId: string; targets?: string[]; style?: string; customPrompt?: string }) =>
      aiRewrite(goodsId, targets, style, customPrompt),
  });
}

export function useUploadImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, file, target }: { goodsId: string; file: File; target: 'main' | 'detail' }) =>
      uploadImage(goodsId, file, target),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['product', v.goodsId] }),
  });
}

export function useReorderImages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, target, order }: { goodsId: string; target: 'main' | 'detail'; order: string[] }) =>
      reorderImages(goodsId, target, order),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['product', v.goodsId] }),
  });
}

// AI Editor
export function useUploadEditorImage() {
  return useMutation({
    mutationFn: (file: File) => uploadEditorImage(file),
  });
}

export function useSearchProductsForEditor(keyword: string, tag?: string, group?: string) {
  return useQuery({
    queryKey: ['productsSearch', keyword, tag, group],
    queryFn: () => searchProductsForEditor(keyword, tag, group),
  });
}

export function useAiHistory(page: number, pageSize = 20) {
  return useQuery({
    queryKey: ['aiHistory', page, pageSize],
    queryFn: () => fetchAiHistory(page, pageSize),
  });
}

export function useDeleteAiHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => deleteAiHistory(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['aiHistory'] }),
  });
}

// Duplicates
export function useDuplicates() {
  return useQuery({ queryKey: ['duplicates'], queryFn: fetchDuplicates, enabled: false });
}

export function usePagination(total: number, pageSize: number) {
  return { totalPages: Math.ceil(total / pageSize) };
}

export function useAiCopywriting() {
  return useMutation({
    mutationFn: ({ goodsId, copyType, style, customPrompt }: { goodsId: string; copyType: string; style: string; customPrompt?: string }) =>
      aiCopywriting(goodsId, copyType, style, customPrompt),
  });
}

export function useAiSuggestPrompt() {
  return useMutation({ mutationFn: aiSuggestPrompt });
}

export function useApplyCopywriting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, fields }: { goodsId: string; fields: Record<string, unknown> }) =>
      applyCopywriting(goodsId, fields),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['product', v.goodsId] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useExportTemplates() {
  return useQuery({ queryKey: ['exportTemplates'], queryFn: fetchExportTemplates });
}

// Monitor
export function useMonitorList() {
  return useQuery({ queryKey: ['monitorList'], queryFn: fetchMonitorList, refetchInterval: 30000 });
}

export function useAddMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goodsId, frequency }: { goodsId: string; frequency: string }) => addMonitor(goodsId, frequency),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitorList'] }),
  });
}

export function useRemoveMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (goodsId: string) => removeMonitor(goodsId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitorList'] }),
  });
}

export function useRefreshMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshMonitor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitorList'] }),
  });
}

export function useCaptureToggle() {
  return useQuery({ queryKey: ['captureToggle'], queryFn: fetchCaptureToggle });
}

export function useSetCaptureToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setCaptureToggle(enabled),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['captureToggle'] }); },
  });
}

export function useAllProductIds(keyword = '') {
  return useQuery({
    queryKey: ['allProductIds', keyword],
    queryFn: () => fetchProductIds(keyword),
  });
}

export function useProductSkus(goodsId: string) {
  return useQuery({
    queryKey: ['productSkus', goodsId],
    queryFn: () => fetchProductSkus(goodsId),
    enabled: !!goodsId,
  });
}

export function useMonitorHistory(goodsId: string) {
  return useQuery({
    queryKey: ['monitorHistory', goodsId],
    queryFn: () => fetchMonitorHistory(goodsId),
    enabled: !!goodsId,
  });
}

export function useLogs(type: string, page = 1, pageSize = 200) {
  return useQuery({
    queryKey: ['logs', type, page],
    queryFn: () => fetchLogs(type, page, pageSize),
    refetchInterval: 3000,
  });
}

export function useLogInfo() {
  return useQuery({ queryKey: ['logInfo'], queryFn: fetchLogInfo, refetchInterval: 10000 });
}

export function useExportLogs() {
  return useMutation({
    mutationFn: (type: string) => exportLogs(type),
  });
}

export function useRemoveBackground() {
  return useMutation({
    mutationFn: (imageUrl: string) => removeBackground(imageUrl),
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: (file: File) => previewImport(file),
  });
}

export function useImportRawJson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => importRawJson(files),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useImportRawJsonDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (directory: string) => importRawJsonDir(directory),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useImportData() {
  return useMutation({
    mutationFn: ({ file, columnMapping }: { file: File; columnMapping?: Record<string, number> }) =>
      importData(file, columnMapping),
  });
}

export function useRiskCheck(enabled = false, interval = 30) {
  return useQuery({
    queryKey: ['riskCheck'],
    queryFn: fetchRiskCheck,
    refetchInterval: enabled ? interval * 1000 : false,
    enabled,
  });
}

export function useDismissRiskCheck() {
  return useMutation({ mutationFn: dismissRiskCheck });
}

export function useShops() {
  return useQuery({ queryKey: ['shops'], queryFn: fetchShops, staleTime: 60000 });
}

