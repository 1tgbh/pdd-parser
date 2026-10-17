import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  useAiGenerateImage, useAiEditImage, useAiUseImage,
  useUploadEditorImage, useSearchProductsForEditor, useAiHistory,
  useAiPresets, useSettings, useTags, useGroups, useRemoveBackground, useDeleteAiHistory, useAiSuggestPrompt,
} from '../hooks/useApi';
import { proxyImage } from '../api/index';
import { useToast } from '../components/Toast';
import type { AiEditorProduct, AiHistoryItem } from '../types';
import s from '../styles/modules/AiEditor.module.css';

const aiClient = axios.create({ baseURL: '/api', timeout: 120000 });

const PRESET_LABELS: Record<string, string> = {
  white_bg: '白底图',
  scene: '场景图',
  poster: '营销海报',
  remove_watermark: '去水印',
  style_cartoon: '卡通风格',
};
const PRESET_KEYS = Object.keys(PRESET_LABELS);

const RESOLUTIONS = [
  { label: '1:1 1024²', value: '1024x1024', desc: '主图' },
  { label: '1:1 800²', value: '800x800', desc: '主图' },
  { label: '4:3 1024×768', value: '1024x768', desc: '横图' },
  { label: '3:4 768×1024', value: '768x1024', desc: '竖图' },
  { label: '16:9 1280×720', value: '1280x720', desc: '横幅' },
  { label: '9:16 720×1280', value: '720x1280', desc: '竖幅' },
  { label: '3:2 960×640', value: '960x640', desc: '横图' },
  { label: '2:3 640×960', value: '640x960', desc: '竖图' },
];

const FILTER_PRESETS = [
  { key: 'fresh', name: '清新', css: 'brightness(1.1) saturate(1.3) contrast(1.05)' },
  { key: 'vintage', name: '复古', css: 'sepia(0.4) contrast(1.1) brightness(0.95)' },
  { key: 'hiCon', name: '高对比', css: 'contrast(1.4) brightness(1.05) saturate(1.1)' },
  { key: 'bw', name: '黑白', css: 'grayscale(1) contrast(1.2)' },
  { key: 'warm', name: '暖色', css: 'sepia(0.2) saturate(1.2) brightness(1.05)' },
  { key: 'cool', name: '冷色', css: 'hue-rotate(15deg) saturate(1.1) brightness(1.05)' },
];

const CANVAS_PRESETS = [
  { name: '800×800 主图', w: 800, h: 800 },
  { name: '750×950 详情', w: 750, h: 950 },
  { name: '790×1334 长图', w: 790, h: 1334 },
  { name: '1242×2208 全屏', w: 1242, h: 2208 },
  { name: '800×1200 竖版', w: 800, h: 1200 },
  { name: '1200×800 横版', w: 1200, h: 800 },
];

type LabelItem = {
  id: string;
  type: 'price' | 'promo' | 'badge';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  bgColor: string;
  borderRadius: number;
  rotation: number;
};

const LABEL_TEMPLATES: Omit<LabelItem, 'id' | 'x' | 'y'>[] = [
  { type: 'price', text: '¥9.9', fontSize: 32, color: '#ffffff', bgColor: '#ff4d4f', borderRadius: 4, width: 120, height: 50, rotation: 0 },
  { type: 'price', text: '¥19.9', fontSize: 32, color: '#ffffff', bgColor: '#ff4d4f', borderRadius: 4, width: 130, height: 50, rotation: 0 },
  { type: 'price', text: '限时特价', fontSize: 18, color: '#ffffff', bgColor: '#ff7a45', borderRadius: 20, width: 100, height: 36, rotation: 0 },
  { type: 'promo', text: '热卖', fontSize: 16, color: '#ffffff', bgColor: '#ff4d4f', borderRadius: 4, width: 80, height: 32, rotation: 0 },
  { type: 'promo', text: '新品上市', fontSize: 16, color: '#ffffff', bgColor: '#1890ff', borderRadius: 4, width: 80, height: 32, rotation: 0 },
  { type: 'promo', text: '买一送一', fontSize: 16, color: '#ffffff', bgColor: '#52c41a', borderRadius: 4, width: 88, height: 32, rotation: 0 },
  { type: 'promo', text: '限时秒杀', fontSize: 16, color: '#ffffff', bgColor: '#ff4d4f', borderRadius: 4, width: 88, height: 32, rotation: -5 },
  { type: 'promo', text: '厂家直销', fontSize: 16, color: '#ffffff', bgColor: '#fa8c16', borderRadius: 4, width: 88, height: 32, rotation: 0 },
  { type: 'badge', text: '品质保证', fontSize: 14, color: '#333333', bgColor: '#fffbe6', borderRadius: 4, width: 88, height: 30, rotation: 0 },
  { type: 'badge', text: '正品保障', fontSize: 14, color: '#333333', bgColor: '#e6f7ff', borderRadius: 4, width: 88, height: 30, rotation: 0 },
  { type: 'badge', text: '7天无理由', fontSize: 14, color: '#333333', bgColor: '#f6ffed', borderRadius: 4, width: 96, height: 30, rotation: 0 },
  { type: 'badge', text: '包邮', fontSize: 14, color: '#1890ff', bgColor: '#e6f7ff', borderRadius: 15, width: 56, height: 28, rotation: 0 },
];

const PLATFORM_SIZES = [
  { name: '拼多多', sizes: [
    { label: '800×800 主图', w: 800, h: 800 },
    { label: '750×950 详情', w: 750, h: 950 },
    { label: '790×1334 长图', w: 790, h: 1334 },
  ]},
  { name: '淘宝', sizes: [
    { label: '800×800 主图', w: 800, h: 800 },
    { label: '790×1100 详情', w: 790, h: 1100 },
    { label: '800×1200 竖版', w: 800, h: 1200 },
  ]},
  { name: '京东', sizes: [
    { label: '800×800 主图', w: 800, h: 800 },
    { label: '960×1200 详情', w: 960, h: 1200 },
  ]},
  { name: '抖音', sizes: [
    { label: '800×800 主图', w: 800, h: 800 },
    { label: '750×1000 详情', w: 750, h: 1000 },
    { label: '1080×1920 短视频', w: 1080, h: 1920 },
  ]},
  { name: '小红书', sizes: [
    { label: '1080×1440 3:4', w: 1080, h: 1440 },
    { label: '1080×1080 1:1', w: 1080, h: 1080 },
    { label: '1080×1920 竖版', w: 1080, h: 1920 },
  ]},
];

function getImgUrl(path: string) {
  if (path.startsWith('http')) return path;
  return `/api/ai-image/${path.replace(/^\/+/, '')}`;
}

function getAllImages(p: AiEditorProduct): string[] {
  return [
    ...p.main_images,
    ...p.detail_images,
    ...p.sku_images.filter(img => !p.main_images.includes(img) && !p.detail_images.includes(img)),
  ];
}

function extractAxiosError(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response: { data?: { error?: string } } }).response;
    if (resp?.data?.error) return resp.data.error;
  }
  if (err instanceof Error) return err.message;
  return '生成失败';
}

export default function AiEditor() {
  const toast = useToast();
  const [sourceImage, setSourceImage] = useState<{ url: string; goodsId?: string } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [leftTab, setLeftTab] = useState<'products' | 'upload' | 'history'>('products');
  const [productKeyword, setProductKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<AiEditorProduct | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  const [selectedPreset, setSelectedPreset] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageCount, setImageCount] = useState(1);

  const [results, setResults] = useState<string[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<number>>(new Set());
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [applyModal, setApplyModal] = useState<{ open: boolean; imagePath: string }>({ open: false, imagePath: '' });
  const [applyKeyword, setApplyKeyword] = useState('');
  const [applyGoodsId, setApplyGoodsId] = useState('');
  const [applyTarget, setApplyTarget] = useState<'main' | 'detail'>('main');

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchResults, setBatchResults] = useState<Record<string, { paths?: string[]; urls?: string[]; error?: string }>>({});
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchKeyword, setBatchKeyword] = useState('');
  const [batchExpandedProducts, setBatchExpandedProducts] = useState<Set<string>>(new Set());

  const [cropMode, setCropMode] = useState(false);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  const [isCropping, setIsCropping] = useState(false);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sourceImgRef = useRef<HTMLImageElement>(null);

  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);

  const [canvasWidth, setCanvasWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [canvasBg, setCanvasBg] = useState('#ffffff');
  const [canvasPresetExpanded, setCanvasPresetExpanded] = useState(false);

  const [compareMode, setCompareMode] = useState(false);
  const [compareOriginal, setCompareOriginal] = useState<string | null>(null);
  const [compareSplit, setCompareSplit] = useState(50);
  const [compareDragging, setCompareDragging] = useState(false);

  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [adjustExpanded, setAdjustExpanded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkSize, setWatermarkSize] = useState(24);
  const [watermarkColor, setWatermarkColor] = useState('#000000');
  const [watermarkOpacity, setWatermarkOpacity] = useState(70);
  const [watermarkPos, setWatermarkPos] = useState({ x: 50, y: 50 });
  const [watermarkDragging, setWatermarkDragging] = useState(false);
  const [watermarkDragOffset, setWatermarkDragOffset] = useState({ x: 0, y: 0 });
  const [textExpanded, setTextExpanded] = useState(false);

  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelText, setEditLabelText] = useState('');
  const [editLabelColor, setEditLabelColor] = useState('#ffffff');
  const [editLabelBgColor, setEditLabelBgColor] = useState('#ff4d4f');
  const [editLabelFontSize, setEditLabelFontSize] = useState(16);
  const [editLabelWidth, setEditLabelWidth] = useState(100);
  const [editLabelHeight, setEditLabelHeight] = useState(32);
  const [editLabelBorderRadius, setEditLabelBorderRadius] = useState(4);
  const [editLabelRotation, setEditLabelRotation] = useState(0);
  const [quickLabelText, setQuickLabelText] = useState('');
  const [labelDragging, setLabelDragging] = useState<string | null>(null);
  const [labelDragOffset, setLabelDragOffset] = useState({ x: 0, y: 0 });
  const [labelResizing, setLabelResizing] = useState<string | null>(null);
  const [labelResizeStart, setLabelResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const [bgFillExpanded, setBgFillExpanded] = useState(false);
  const [bgFillColor, setBgFillColor] = useState('#ffffff');
  const [bgFillGradient, setBgFillGradient] = useState(false);
  const [bgFillGradientEnd, setBgFillGradientEnd] = useState('#e0e0e0');
  const [bgFillLoading, setBgFillLoading] = useState(false);

  const [platformExpanded, setPlatformExpanded] = useState(false);

  const [historySelected, setHistorySelected] = useState<Set<number>>(new Set());
  const [historyDeleteConfirm, setHistoryDeleteConfirm] = useState(false);

  const [exportModal, setExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [exportScale, setExportScale] = useState(100);
  const [exportTarget, setExportTarget] = useState<string | null>(null);

  const { data: presets } = useAiPresets();
  const { data: settings } = useSettings();
  const { data: tags } = useTags();
  const { data: groups } = useGroups();
  const { data: historyData } = useAiHistory(1, 60);
  const { data: searchResult } = useSearchProductsForEditor(productKeyword, tagFilter || undefined, groupFilter || undefined);
  const { data: applySearchResult } = useSearchProductsForEditor(applyKeyword);

  const searchResults = searchResult?.items;
  const applySearchResults = applySearchResult?.items;

  const uploadMut = useUploadEditorImage();
  const editMut = useAiEditImage();
  const generateMut = useAiGenerateImage();
  const useImageMut = useAiUseImage();
  const removeBgMut = useRemoveBackground();
  const deleteHistMut = useDeleteAiHistory();
  const suggestPromptMut = useAiSuggestPrompt();

  const isApiReady = settings?.image_api?.api_key_set;
  const generating = editMut.isPending || generateMut.isPending || removeBgMut.isPending;

  const saveToHistory = useCallback((imageUrl: string) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(imageUrl);
      if (newHistory.length > 50) newHistory.shift();
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const handleSuggestPrompt = useCallback(async () => {
    const imageUrl = sourceImage?.url || (selectedProduct?.main_images?.[0] || '');
    if (!imageUrl) { toast.info('请先选择或上传一张图片'); return; }
    try {
      const result = await suggestPromptMut.mutateAsync(imageUrl);
      if (result.prompt) { setCustomPrompt(result.prompt); toast.success('提示词已生成'); }
      else { toast.error(result.error || '生成失败'); }
    } catch { toast.error('提示词生成失败'); }
  }, [sourceImage, selectedProduct, suggestPromptMut, toast]);

  const handleRemoveBg = useCallback(async () => {
    if (!sourceImage) return;
    try {
      const newUrl = await removeBgMut.mutateAsync(sourceImage.url);
      setSourceImage({ url: newUrl, goodsId: sourceImage.goodsId });
      saveToHistory(newUrl);
    } catch (e) {
      console.error('Remove bg failed:', e);
    }
  }, [sourceImage, removeBgMut, saveToHistory]);

  const effectivePrompt = useMemo(() => {
    if (customPrompt.trim()) return customPrompt;
    if (selectedPreset && presets?.[selectedPreset]) return presets[selectedPreset];
    return customPrompt;
  }, [selectedPreset, presets, customPrompt]);

  const canGenerate = useMemo(() => {
    return !!effectivePrompt.trim() && !generating && !!isApiReady;
  }, [effectivePrompt, generating, isApiReady]);

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setSourceImage({ url: history[newIndex] });
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setSourceImage({ url: history[newIndex] });
  }, [history, historyIndex]);

  const handleSearch = useCallback(() => {
    setProductKeyword(searchInput.trim());
  }, [searchInput]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setProductKeyword('');
    setTagFilter('');
    setGroupFilter('');
  }, []);

  const handleProductClick = useCallback((p: AiEditorProduct) => {
    setSelectedProduct(prev => prev?.goods_id === p.goods_id ? null : p);
  }, []);

  const handleImageSelect = useCallback((url: string, goodsId?: string) => {
    setSourceImage({ url, goodsId });
    saveToHistory(url);
  }, [saveToHistory]);

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
    if (validFiles.length === 0) {
      toast.error('仅支持 JPG、PNG、WebP 格式的图片');
      return;
    }
    try {
      const results = await Promise.all(validFiles.map(file => uploadMut.mutateAsync(file)));
      const urls = results.filter(r => r.ok).map(r => r.url);
      if (urls.length > 0) {
        if (batchMode) {
          setBatchSelected(prev => {
            const next = new Set(prev);
            urls.forEach(url => next.add(url));
            return next;
          });
        } else {
          setSourceImage({ url: urls[0] });
        }
      }
    } catch {
      toast.error('上传失败');
    }
  }, [uploadMut, batchMode, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
    e.target.value = '';
  }, [handleFileUpload]);

  const handleHistoryClick = useCallback((item: AiHistoryItem) => {
    const url = getImgUrl(item.result_path);
    setSourceImage({ url, goodsId: item.goods_id || undefined });
    saveToHistory(url);
  }, [saveToHistory]);

  const handleHistoryToggle = useCallback((id: number) => {
    setHistorySelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleHistorySelectAll = useCallback(() => {
    if (!historyData?.items) return;
    if (historySelected.size === historyData.items.length) {
      setHistorySelected(new Set());
    } else {
      setHistorySelected(new Set(historyData.items.map(item => item.id)));
    }
  }, [historyData, historySelected]);

  const handleDownload = useCallback(async (imgPath: string) => {
    try {
      const url = getImgUrl(imgPath);
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ai_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('下载失败');
    }
  }, [toast]);

  const handleHistoryExport = useCallback(() => {
    if (!historyData?.items || historySelected.size === 0) return;
    const selectedItems = historyData.items.filter(item => historySelected.has(item.id));
    selectedItems.forEach(item => {
      handleDownload(item.result_path);
    });
  }, [historyData, historySelected, handleDownload]);

  const handleHistoryDelete = useCallback(async () => {
    if (historySelected.size === 0) return;
    try {
      await deleteHistMut.mutateAsync(Array.from(historySelected));
      setHistorySelected(new Set());
      setHistoryDeleteConfirm(false);
    } catch {
      toast.error('删除失败');
    }
  }, [historySelected, deleteHistMut, toast]);

  const handleBatchDownload = useCallback(async () => {
    for (const idx of selectedResults) {
      const p = results[idx];
      if (p) await handleDownload(p);
    }
  }, [selectedResults, results, handleDownload]);

  const handleBatchGenerate = useCallback(async () => {
    if (batchSelected.size < 1 || !selectedPreset || !isApiReady) return;
    setBatchGenerating(true);
    setBatchResults({});
    try {
      const resp = await aiClient.post('/ai/batch-generate', {
        images: Array.from(batchSelected),
        preset: selectedPreset,
      });
      setBatchResults(resp.data.results || {});
    } catch {
      toast.error('批量生成失败');
    } finally {
      setBatchGenerating(false);
    }
  }, [batchSelected, selectedPreset, isApiReady, toast]);

  const handleBatchToggleImage = useCallback((imageUrl: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(imageUrl)) next.delete(imageUrl);
      else next.add(imageUrl);
      return next;
    });
  }, []);

  const handleBatchSelectAll = useCallback(() => {
    if (!searchResults) return;
    const allImages = searchResults.flatMap(p => getAllImages(p));
    setBatchSelected(prev => {
      if (prev.size === allImages.length && allImages.every(img => prev.has(img))) return new Set();
      return new Set(allImages);
    });
  }, [searchResults]);

  const handleBatchToggleProduct = useCallback((goodsId: string) => {
    setBatchExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(goodsId)) next.delete(goodsId);
      else next.add(goodsId);
      return next;
    });
  }, []);

  const handleBatchToggleProductImages = useCallback((goodsId: string) => {
    if (!searchResults) return;
    const product = searchResults.find(p => p.goods_id === goodsId);
    if (!product) return;
    const images = getAllImages(product);
    setBatchSelected(prev => {
      const next = new Set(prev);
      const allSelected = images.every(img => next.has(img));
      if (allSelected) {
        images.forEach(img => next.delete(img));
      } else {
        images.forEach(img => next.add(img));
      }
      return next;
    });
  }, [searchResults]);

  const handleBatchClearResults = useCallback(() => {
    setBatchResults({});
  }, []);

  const handleBatchDownloadAll = useCallback(async () => {
    for (const gid of Object.keys(batchResults)) {
      const r = batchResults[gid];
      const items = r?.urls || r?.paths || [];
      for (const p of items) {
        await handleDownload(p);
      }
    }
  }, [batchResults, handleDownload]);

  const handleToggleResultSelect = useCallback((idx: number) => {
    setSelectedResults(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleContinueEdit = useCallback((imgPath: string) => {
    const url = getImgUrl(imgPath);
    setSourceImage({ url, goodsId: sourceImage?.goodsId });
    saveToHistory(url);
    setCustomPrompt('');
    setResults(prev => prev.filter(p => p !== imgPath));
    setSelectedResults(new Set());
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPanX(0);
    setPanY(0);
  }, [sourceImage, saveToHistory]);

  const handleApply = useCallback((imgPath: string) => {
    setApplyModal({ open: true, imagePath: imgPath });
    setApplyKeyword('');
    setApplyGoodsId('');
    setApplyTarget('main');
  }, []);

  const handleApplySubmit = useCallback(async () => {
    if (!applyGoodsId || !applyModal.imagePath) return;
    try {
      await useImageMut.mutateAsync({
        goodsId: applyGoodsId,
        imagePath: applyModal.imagePath,
        target: applyTarget,
      });
      setApplyModal({ open: false, imagePath: '' });
      setResults(prev => prev.filter(p => p !== applyModal.imagePath));
      setSelectedResults(new Set());
      toast.success('应用成功');
    } catch {
      toast.error('应用失败');
    }
  }, [applyGoodsId, applyModal.imagePath, applyTarget, useImageMut, toast]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    const count = Math.max(1, Math.min(4, imageCount));
    try {
      const tasks = Array.from({ length: count }, async () => {
        if (sourceImage) {
          return editMut.mutateAsync({
            imageUrl: sourceImage.url,
            prompt: effectivePrompt,
            goodsId: sourceImage.goodsId || '_editor',
            preset: selectedPreset || undefined,
            size: aspectRatio,
          });
        }
        return generateMut.mutateAsync({
          prompt: effectivePrompt,
          goodsId: '_editor',
          size: aspectRatio,
        });
      });
      const results = await Promise.allSettled(tasks);
      const paths: string[] = [];
      const errors: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.error) errors.push(r.value.error);
          else if (r.value.urls) paths.push(...r.value.urls);
          else if (r.value.paths) paths.push(...r.value.paths);
        } else {
          errors.push(extractAxiosError(r.reason));
        }
      }
      if (paths.length > 0) {
        setResults(prev => [...paths, ...prev]);
      }
      if (errors.length > 0 && paths.length === 0) {
        toast.error(errors[0]);
      }
    } catch (err: unknown) {
      toast.error(extractAxiosError(err));
    }
  }, [canGenerate, sourceImage, effectivePrompt, selectedPreset, aspectRatio, imageCount, editMut, generateMut, toast]);

  // Reset view transforms when the source image changes (adjust state during render)
  const [prevSourceImage, setPrevSourceImage] = useState(sourceImage);
  if (sourceImage !== prevSourceImage) {
    setPrevSourceImage(sourceImage);
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPanX(0);
    setPanY(0);
    setCropMode(false);
  }

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => {
        const next = z + (e.deltaY > 0 ? -0.1 : 0.1);
        return Math.max(0.25, Math.min(4, Math.round(next * 100) / 100));
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const handleCanvasDblClick = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (cropMode || zoom <= 1) return;
    e.preventDefault();
    panStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    setIsPanning(true);
  }, [cropMode, zoom, panX, panY]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPanX(panStartRef.current.px + dx);
    setPanY(panStartRef.current.py + dy);
  }, [isPanning]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handleRotateLeft = useCallback(() => setRotation(r => (r - 90) % 360), []);
  const handleRotateRight = useCallback(() => setRotation(r => (r + 90) % 360), []);
  const handleFlipH = useCallback(() => setFlipH(f => !f), []);
  const handleFlipV = useCallback(() => setFlipV(f => !f), []);
  const handleResetTransform = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPanX(0);
    setPanY(0);
    setCropMode(false);
  }, []);

  const handleApplyAdjustments = useCallback(async () => {
    if (!sourceImage) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('file', blob, 'adjusted.png');
        try {
          const resp = await fetch('/api/ai/upload-image', { method: 'POST', body: formData });
          const data = await resp.json();
          if (data.url) {
            setSourceImage({ url: data.url, goodsId: sourceImage?.goodsId });
            saveToHistory(data.url);
            setBrightness(100);
            setContrast(100);
            setSaturation(100);
          }
        } catch (e) {
          console.error('Failed to apply adjustments', e);
        }
      }, 'image/png');
    };
    img.src = sourceImage.url;
  }, [sourceImage, brightness, contrast, saturation, saveToHistory]);

  const handleApplyFilter = useCallback(async () => {
    if (!sourceImage || !activeFilter) return;
    const filterCss = FILTER_PRESETS.find(f => f.key === activeFilter)?.css;
    if (!filterCss) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.filter = filterCss;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('file', blob, 'filtered.png');
        try {
          const resp = await fetch('/api/ai/upload-image', { method: 'POST', body: formData });
          const data = await resp.json();
          if (data.url) {
            setSourceImage({ url: data.url, goodsId: sourceImage?.goodsId });
            if (typeof saveToHistory === 'function') saveToHistory(data.url);
            setActiveFilter(null);
          }
        } catch (e) { console.error(e); }
      }, 'image/png');
    };
    img.src = sourceImage.url;
  }, [sourceImage, activeFilter, saveToHistory]);

  const hasTransform = rotation !== 0 || flipH || flipV;

  const handleApplyTransform = useCallback(async () => {
    if (!sourceImage || !hasTransform) return;
    try {
      let imgUrl = sourceImage.url;
      if (imgUrl.startsWith('http')) {
        const proxyRes = await proxyImage(imgUrl);
        if (proxyRes.ok) imgUrl = proxyRes.url;
      }
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片加载失败'));
        el.src = imgUrl;
      });
      const rad = (rotation * Math.PI) / 180;
      const absRot = ((rotation % 360) + 360) % 360;
      const swapped = absRot === 90 || absRot === 270;
      const w = swapped ? img.naturalHeight : img.naturalWidth;
      const h = swapped ? img.naturalWidth : img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rad);
      if (flipH) ctx.scale(-1, 1);
      if (flipV) ctx.scale(1, -1);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });
      const file = new File([blob], `transform_${Date.now()}.png`, { type: 'image/png' });
      const res = await uploadMut.mutateAsync(file);
      if (res.ok) {
        setSourceImage({ url: res.url, goodsId: sourceImage.goodsId });
      }
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
    } catch {
      toast.error('变换应用失败');
    }
  }, [sourceImage, hasTransform, rotation, flipH, flipV, uploadMut, toast]);

  const imageTransform = useMemo(() => {
    const parts: string[] = [];
    if (panX || panY) parts.push(`translate(${panX}px, ${panY}px)`);
    parts.push(`scale(${zoom})`);
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (flipH) parts.push('scaleX(-1)');
    if (flipV) parts.push('scaleY(-1)');
    return parts.join(' ') || 'none';
  }, [zoom, rotation, flipH, flipV, panX, panY]);

  const combinedFilter = useMemo(() => {
    return [
      activeFilter ? FILTER_PRESETS.find(f => f.key === activeFilter)?.css : null,
      brightness !== 100 ? `brightness(${brightness}%)` : null,
      contrast !== 100 ? `contrast(${contrast}%)` : null,
      saturation !== 100 ? `saturate(${saturation}%)` : null,
    ].filter(Boolean).join(' ') || 'none';
  }, [activeFilter, brightness, contrast, saturation]);

  const handleCropStart = useCallback(() => {
    setCropMode(true);
    setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPanX(0);
    setPanY(0);
  }, []);

  const handleCropMouseDown = useCallback((e: React.MouseEvent) => {
    if (!cropMode || !sourceImgRef.current || !canvasContainerRef.current) return;
    const imgRect = sourceImgRef.current.getBoundingClientRect();
    const x = e.clientX - imgRect.left;
    const y = e.clientY - imgRect.top;
    cropStartRef.current = { x: e.clientX, y: e.clientY };
    setCropRect({ x, y, w: 0, h: 0 });
    setIsCropping(true);
  }, [cropMode]);

  const handleCropMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isCropping || !cropStartRef.current || !sourceImgRef.current) return;
    const imgRect = sourceImgRef.current.getBoundingClientRect();
    const startX = cropStartRef.current.x - imgRect.left;
    const startY = cropStartRef.current.y - imgRect.top;
    const endX = e.clientX - imgRect.left;
    const endY = e.clientY - imgRect.top;
    const x = Math.max(0, Math.min(startX, endX));
    const y = Math.max(0, Math.min(startY, endY));
    const w = Math.min(Math.abs(endX - startX), imgRect.width - x);
    const h = Math.min(Math.abs(endY - startY), imgRect.height - y);
    setCropRect({ x, y, w, h });
  }, [isCropping]);

  const handleCropMouseUp = useCallback(() => {
    setIsCropping(false);
    cropStartRef.current = null;
  }, []);

  const handleCropConfirm = useCallback(async () => {
    if (!sourceImage || cropRect.w < 10 || cropRect.h < 10) {
      setCropMode(false);
      return;
    }
    try {
      let imgUrl = sourceImage.url;
      if (imgUrl.startsWith('http')) {
        const proxyRes = await proxyImage(imgUrl);
        if (proxyRes.ok) imgUrl = proxyRes.url;
      }
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('图片加载失败'));
        el.src = imgUrl;
      });
      const imgRect = sourceImgRef.current?.getBoundingClientRect();
      const displayW = imgRect?.width || img.width;
      const displayH = imgRect?.height || img.height;
      const scaleX = img.naturalWidth / displayW;
      const scaleY = img.naturalHeight / displayH;
      const sx = Math.round(cropRect.x * scaleX);
      const sy = Math.round(cropRect.y * scaleY);
      const sw = Math.round(cropRect.w * scaleX);
      const sh = Math.round(cropRect.h * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => {
          if (b) resolve(b);
          else reject(new Error('Failed to create blob'));
        }, 'image/png');
      });
      const file = new File([blob], `crop_${Date.now()}.png`, { type: 'image/png' });
      const res = await uploadMut.mutateAsync(file);
      if (res.ok) {
        const newUrl = res.url;
        setSourceImage({ url: newUrl, goodsId: sourceImage.goodsId });
        saveToHistory(newUrl);
      }
      setCropMode(false);
      setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    } catch {
      toast.error('裁剪上传失败');
    }
  }, [sourceImage, cropRect, uploadMut, saveToHistory, toast]);

  const handleCropCancel = useCallback(() => {
    setCropMode(false);
    setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    setIsCropping(false);
  }, []);

  const handleApplyWatermark = useCallback(async () => {
    if (!sourceImage || !watermarkText) return;
    const imgUrl = sourceImage.url;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      ctx.font = `${watermarkSize}px sans-serif`;
      ctx.fillStyle = watermarkColor;
      ctx.globalAlpha = watermarkOpacity / 100;
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 2;
      ctx.fillText(watermarkText, watermarkPos.x, watermarkPos.y);
      ctx.globalAlpha = 1;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('file', blob, 'watermarked.png');
        try {
          const resp = await fetch('/api/ai/upload-image', { method: 'POST', body: formData });
          const data = await resp.json();
          if (data.url) {
            setSourceImage({ url: data.url, goodsId: sourceImage.goodsId });
            saveToHistory(data.url);
            setWatermarkText('');
          }
        } catch (e) { console.error(e); }
      }, 'image/png');
    };
    img.src = imgUrl;
  }, [sourceImage, watermarkText, watermarkSize, watermarkColor, watermarkOpacity, watermarkPos, saveToHistory]);

  const handleOpenExport = useCallback((target?: string) => {
    setExportTarget(target || 'single');
    setExportModal(true);
  }, []);

  const handleExportConfirm = useCallback(async () => {
    const imagesToExport: string[] = [];
    if (exportTarget === 'batch' && batchResults) {
      Object.values(batchResults).forEach(r => { const items = r.urls || r.paths || []; imagesToExport.push(...items); });
    } else if (results && results.length > 0) {
      imagesToExport.push(...results);
    } else if (sourceImage) {
      imagesToExport.push(sourceImage.url);
    }

    if (imagesToExport.length === 0) return;

    const mimeType = `image/${exportFormat}`;
    const quality = exportQuality / 100;

    for (const url of imagesToExport) {
      try {
        const imgUrl = getImgUrl(url);
        let blob: Blob | null = null;

        if (imgUrl.startsWith('http')) {
          const resp = await fetch(imgUrl);
          const origBlob = await resp.blob();
          const bmp = await createImageBitmap(origBlob);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(bmp.width * exportScale / 100);
          canvas.height = Math.round(bmp.height * exportScale / 100);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
          blob = await new Promise<Blob | null>(r => canvas.toBlob(r, mimeType, quality));
          bmp.close();
        } else {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = imgUrl;
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * exportScale / 100);
          canvas.height = Math.round(img.naturalHeight * exportScale / 100);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          blob = await new Promise<Blob | null>(r => canvas.toBlob(r, mimeType, quality));
        }

        if (!blob) continue;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `export_${Date.now()}.${exportFormat}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (e) { console.error('Export failed:', e); }
    }
    setExportModal(false);
  }, [exportTarget, results, batchResults, sourceImage, exportFormat, exportQuality, exportScale]);

  const handleAddLabel = useCallback((template: Omit<LabelItem, 'id' | 'x' | 'y'>) => {
    const offset = (labels.length % 8) * 30;
    const newLabel: LabelItem = {
      ...template,
      id: `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      x: 20 + offset,
      y: 20 + offset,
    };
    setLabels(prev => [...prev, newLabel]);
    setSelectedLabelId(newLabel.id);
  }, [labels.length]);

  const handleLabelDragStart = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLabelId(id);
    const label = labels.find(l => l.id === id);
    if (label) {
      setLabelDragging(id);
      setLabelDragOffset({ x: e.clientX - label.x, y: e.clientY - label.y });
    }
  }, [labels]);

  const handleLabelResizeStart = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const label = labels.find(l => l.id === id);
    if (label) {
      setLabelResizing(id);
      setLabelResizeStart({ x: e.clientX, y: e.clientY, w: label.width, h: label.height });
    }
  }, [labels]);

  const handleLabelDoubleClick = useCallback((id: string) => {
    const label = labels.find(l => l.id === id);
    if (label) {
      setEditingLabelId(id);
      setEditLabelText(label.text);
      setEditLabelColor(label.color);
      setEditLabelBgColor(label.bgColor);
      setEditLabelFontSize(label.fontSize);
      setEditLabelWidth(label.width);
      setEditLabelHeight(label.height);
      setEditLabelBorderRadius(label.borderRadius);
      setEditLabelRotation(label.rotation);
    }
  }, [labels]);

  // Mirror the in-progress label edits into the committed label so the canvas
  // preview updates live (adjust state during render)
  const editingLabel = labels.find(l => l.id === editingLabelId);
  if (editingLabel && (
    editingLabel.text !== editLabelText || editingLabel.color !== editLabelColor ||
    editingLabel.bgColor !== editLabelBgColor || editingLabel.fontSize !== editLabelFontSize ||
    editingLabel.width !== editLabelWidth || editingLabel.height !== editLabelHeight ||
    editingLabel.borderRadius !== editLabelBorderRadius || editingLabel.rotation !== editLabelRotation
  )) {
    setLabels(prev => prev.map(l => l.id === editingLabelId ? {
      ...l, text: editLabelText, color: editLabelColor, bgColor: editLabelBgColor,
      fontSize: editLabelFontSize, width: editLabelWidth, height: editLabelHeight,
      borderRadius: editLabelBorderRadius, rotation: editLabelRotation,
    } : l));
  }

  const handleDeleteLabel = useCallback((id: string) => {
    setLabels(prev => prev.filter(l => l.id !== id));
    if (selectedLabelId === id) setSelectedLabelId(null);
  }, [selectedLabelId]);

  const handleClearLabels = useCallback(() => {
    setLabels([]);
    setSelectedLabelId(null);
  }, []);

  const handleApplyLabels = useCallback(async () => {
    if (!sourceImage || labels.length === 0) return;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = sourceImage.url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);

      const wrapperEl = sourceImgRef.current?.parentElement;
      const wrapperW = wrapperEl?.clientWidth || img.naturalWidth;
      const wrapperH = wrapperEl?.clientHeight || img.naturalHeight;
      const scaleX = img.naturalWidth / wrapperW;
      const scaleY = img.naturalHeight / wrapperH;

      for (const label of labels) {
        ctx.save();
        const lx = label.x * scaleX;
        const ly = label.y * scaleY;
        const lw = label.width * scaleX;
        const lh = label.height * scaleY;
        const lfs = label.fontSize * Math.min(scaleX, scaleY);

        ctx.translate(lx + lw / 2, ly + lh / 2);
        ctx.rotate((label.rotation * Math.PI) / 180);
        ctx.translate(-(lx + lw / 2), -(ly + lh / 2));

        ctx.fillStyle = label.bgColor;
        ctx.beginPath();
        const r = Math.min(label.borderRadius * Math.min(scaleX, scaleY), lw / 2, lh / 2);
        ctx.moveTo(lx + r, ly);
        ctx.lineTo(lx + lw - r, ly);
        ctx.quadraticCurveTo(lx + lw, ly, lx + lw, ly + r);
        ctx.lineTo(lx + lw, ly + lh - r);
        ctx.quadraticCurveTo(lx + lw, ly + lh, lx + lw - r, ly + lh);
        ctx.lineTo(lx + r, ly + lh);
        ctx.quadraticCurveTo(lx, ly + lh, lx, ly + lh - r);
        ctx.lineTo(lx, ly + r);
        ctx.quadraticCurveTo(lx, ly, lx + r, ly);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = label.color;
        ctx.font = `bold ${lfs}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.text, lx + lw / 2, ly + lh / 2);
        ctx.restore();
      }

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      const file = new File([blob], `labeled_${Date.now()}.png`, { type: 'image/png' });
      const res = await uploadMut.mutateAsync(file);
      if (res.ok) {
        setSourceImage({ url: res.url, goodsId: sourceImage.goodsId });
        saveToHistory(res.url);
        setLabels([]);
        setSelectedLabelId(null);
      }
    } catch (e) {
      console.error('Apply labels failed:', e);
      toast.error('应用标签失败，请重试');
    }
  }, [sourceImage, labels, uploadMut, saveToHistory, toast]);

  const handleFillBackground = useCallback(async () => {
    if (!sourceImage) return;
    setBgFillLoading(true);
    try {
      const resp = await aiClient.post('/ai/fill-background', {
        image_url: sourceImage.url,
        fill_color: bgFillColor,
        fill_type: bgFillGradient ? 'gradient_top_bottom' : 'solid',
        gradient_end: bgFillGradientEnd,
      });
      if (resp.data?.ok && resp.data?.url) {
        const newUrl = resp.data.url.startsWith('/') ? resp.data.url : getImgUrl(resp.data.url);
        setSourceImage(prev => prev ? { ...prev, url: newUrl } : prev);
        saveToHistory(newUrl);
      }
    } catch (e) {
      console.error('Fill background failed:', e);
      toast.error('背景填充失败，请检查图片和后端服务');
    } finally {
      setBgFillLoading(false);
    }
  }, [sourceImage, bgFillColor, bgFillGradient, bgFillGradientEnd, saveToHistory, toast]);

  const handlePlatformAdapt = useCallback((targetW: number, targetH: number) => {
    setCanvasWidth(targetW);
    setCanvasHeight(targetH);
    setPlatformExpanded(false);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (cropMode && isCropping && cropStartRef.current && sourceImgRef.current) {
        const imgRect = sourceImgRef.current.getBoundingClientRect();
        const startX = cropStartRef.current.x - imgRect.left;
        const startY = cropStartRef.current.y - imgRect.top;
        const endX = e.clientX - imgRect.left;
        const endY = e.clientY - imgRect.top;
        const x = Math.max(0, Math.min(startX, endX));
        const y = Math.max(0, Math.min(startY, endY));
        const w = Math.min(Math.abs(endX - startX), imgRect.width - x);
        const h = Math.min(Math.abs(endY - startY), imgRect.height - y);
        setCropRect({ x, y, w, h });
      } else if (isPanning && panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPanX(panStartRef.current.px + dx);
        setPanY(panStartRef.current.py + dy);
      }
    };
    const handleMouseUp = () => {
      setIsCropping(false);
      cropStartRef.current = null;
      setIsPanning(false);
      panStartRef.current = null;
    };
    if (isPanning || isCropping) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isPanning, isCropping, cropMode]);

  useEffect(() => {
    if (!watermarkDragging) return;
    const handleMove = (e: MouseEvent) => {
      setWatermarkPos({ x: e.clientX - watermarkDragOffset.x, y: e.clientY - watermarkDragOffset.y });
    };
    const handleUp = () => setWatermarkDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [watermarkDragging, watermarkDragOffset]);

  useEffect(() => {
    if (!labelDragging && !labelResizing) return;
    const handleMove = (e: MouseEvent) => {
      if (labelDragging) {
        setLabels(prev => prev.map(l => l.id === labelDragging ? {
          ...l, x: e.clientX - labelDragOffset.x, y: e.clientY - labelDragOffset.y
        } : l));
      }
      if (labelResizing) {
        const dx = e.clientX - labelResizeStart.x;
        const dy = e.clientY - labelResizeStart.y;
        setLabels(prev => prev.map(l => l.id === labelResizing ? {
          ...l, width: Math.max(40, labelResizeStart.w + dx), height: Math.max(20, labelResizeStart.h + dy)
        } : l));
      }
    };
    const handleUp = () => {
      if (labelDragging) setLabelDragging(null);
      if (labelResizing) setLabelResizing(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [labelDragging, labelResizing, labelDragOffset, labelResizeStart]);

  useEffect(() => {
    if (!compareDragging) return;
    const handleMove = (e: MouseEvent) => {
      const container = document.querySelector('[data-canvas-area]');
      if (container) {
        const rect = container.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        setCompareSplit(pct);
      }
    };
    const handleUp = () => setCompareDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [compareDragging]);

  return (
    <div className={s.container}>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <div className={s.leftPanel}>
        {!batchMode && (
          <div className={s.tabBar}>
            <button
              className={`${s.tab} ${leftTab === 'products' ? s.tabActive : ''}`}
              onClick={() => setLeftTab('products')}
            >商品图片</button>
            <button
              className={`${s.tab} ${leftTab === 'upload' ? s.tabActive : ''}`}
              onClick={() => setLeftTab('upload')}
            >上传图片</button>
            <button
              className={`${s.tab} ${leftTab === 'history' ? s.tabActive : ''}`}
              onClick={() => setLeftTab('history')}
            >历史图片</button>
          </div>
        )}

        {batchMode && (
          <div className={s.tabBar}>
            <div className={`${s.tab} ${s.tabActive}`} style={{ cursor: 'default' }}>
              批量选择 (已选 {batchSelected.size} 张图片)
            </div>
          </div>
        )}

        <div className={s.panelBody}>
          {batchMode && (
            <>
              <div className={s.searchBox}>
                <input
                  value={batchKeyword}
                  onChange={e => setBatchKeyword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && setProductKeyword(batchKeyword.trim())}
                  placeholder="搜索商品..."
                />
                <button className="btn btn-primary btn-sm" onClick={() => setProductKeyword(batchKeyword.trim())}>搜索</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button className="btn btn-outline btn-sm" onClick={handleBatchSelectAll}>
                  {searchResults && searchResults.length > 0 && searchResults.every(p => getAllImages(p).every(img => batchSelected.has(img))) ? '取消全选' : '全选所有图片'}
                </button>
                {batchSelected.size > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={() => setBatchSelected(new Set())}>
                    清除选择
                  </button>
                )}
              </div>
              <div className={s.productList}>
                {searchResults && searchResults.length > 0 && searchResults.map(p => {
                  const images = getAllImages(p);
                  const isExpanded = batchExpandedProducts.has(p.goods_id);
                  const selectedCount = images.filter(img => batchSelected.has(img)).length;
                  const allSelected = images.length > 0 && selectedCount === images.length;
                  return (
                    <div key={p.goods_id}>
                      <div
                        className={`${s.productItem} ${selectedCount > 0 ? s.productItemActive : ''}`}
                        onClick={() => handleBatchToggleProduct(p.goods_id)}
                      >
                        <input
                          type="checkbox"
                          className={s.batchCheckbox}
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = !allSelected && selectedCount > 0; }}
                          onChange={() => handleBatchToggleProductImages(p.goods_id)}
                          onClick={e => e.stopPropagation()}
                        />
                        {p.main_images[0] && (
                          <img className={s.productThumb} src={p.main_images[0]} alt="" />
                        )}
                        <div className={s.productInfo}>
                          <div className={s.productTitle}>{p.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                            {selectedCount > 0 ? `${selectedCount}/${images.length} 张已选` : `${images.length} 张图片`}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 'auto', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                          ▶
                        </span>
                      </div>
                      {isExpanded && (
                        <div className={s.productImages}>
                          {images.map((img, i) => (
                            <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                              <img
                                className={`${s.productImg} ${batchSelected.has(img) ? s.productImgActive : ''}`}
                                src={img}
                                alt=""
                                onClick={() => handleBatchToggleImage(img)}
                              />
                              <input
                                type="checkbox"
                                style={{ position: 'absolute', top: 4, left: 4, width: 14, height: 14, cursor: 'pointer', margin: 0 }}
                                checked={batchSelected.has(img)}
                                onChange={() => handleBatchToggleImage(img)}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {searchResults && searchResults.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '20px 0', fontSize: 13 }}>
                    {batchKeyword ? '未找到匹配商品' : '暂无商品数据'}
                  </div>
                )}
                {!searchResults && (
                  <div style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '20px 0', fontSize: 13 }}>
                    加载中...
                  </div>
                )}
              </div>
            </>
          )}

          {!batchMode && leftTab === 'products' && (
            <>
              <div className={s.searchBox}>
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索商品名称/店铺..."
                />
                {productKeyword || tagFilter || groupFilter ? (
                  <button className="btn btn-outline btn-sm" onClick={handleClearSearch}>清除</button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={handleSearch}>搜索</button>
                )}
              </div>
              {(tags && tags.length > 0) || (groups && groups.length > 0) ? (
                <div className={s.filterRow}>
                  {tags && tags.length > 0 && (
                    <select
                      className={s.filterSelect}
                      value={tagFilter}
                      onChange={e => setTagFilter(e.target.value)}
                    >
                      <option value="">全部标签</option>
                      {tags.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                  {groups && groups.length > 0 && (
                    <select
                      className={s.filterSelect}
                      value={groupFilter}
                      onChange={e => setGroupFilter(e.target.value)}
                    >
                      <option value="">全部分组</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              ) : null}
              <div className={s.productList}>
                {searchResults && searchResults.length > 0 && searchResults.map(p => (
                  <div key={p.goods_id}>
                    <div
                      className={`${s.productItem} ${selectedProduct?.goods_id === p.goods_id ? s.productItemActive : ''}`}
                      onClick={() => handleProductClick(p)}
                    >
                      {p.main_images[0] && (
                        <img className={s.productThumb} src={p.main_images[0]} alt="" />
                      )}
                      <div className={s.productInfo}>
                        <div className={s.productTitle}>{p.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                          {getAllImages(p).length} 张图片
                        </div>
                      </div>
                    </div>
                    {selectedProduct?.goods_id === p.goods_id && (
                      <div className={s.productImages}>
                        {getAllImages(p).map((img, i) => (
                          <img
                            key={i}
                            className={`${s.productImg} ${sourceImage?.url === img ? s.productImgActive : ''}`}
                            src={img}
                            alt=""
                            onClick={() => handleImageSelect(img, p.goods_id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {searchResults && searchResults.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '20px 0', fontSize: 13 }}>
                    {productKeyword || tagFilter || groupFilter ? '未找到匹配商品' : '暂无商品数据'}
                  </div>
                )}
                {!searchResults && (
                  <div style={{ textAlign: 'center', color: 'var(--gray-400)', padding: '20px 0', fontSize: 13 }}>
                    加载中...
                  </div>
                )}
              </div>
            </>
          )}

          {leftTab === 'upload' && (
            <div
              className={`${s.uploadZone} ${isDragging ? s.uploadZoneDragOver : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className={s.uploadIcon}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:32,height:32}}>
                  <path d="M10 14V3"/>
                  <path d="M6 7l4-4 4 4"/>
                  <path d="M3 13v2a2 2 0 002 2h10a2 2 0 002-2v-2"/>
                </svg>
              </div>
              <div>点击或拖拽图片到此处</div>
              <div className={s.uploadHint}>支持 JPG、PNG、WebP 格式</div>
            </div>
          )}

          {leftTab === 'history' && (
            <>
              {historyData && historyData.items.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button className="btn btn-outline btn-sm" onClick={handleHistorySelectAll}>
                    {historySelected.size === historyData.items.length ? '取消全选' : '全选'}
                  </button>
                  {historySelected.size > 0 && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={handleHistoryExport}>
                        导出 ({historySelected.size})
                      </button>
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--brand-red)' }} onClick={() => setHistoryDeleteConfirm(true)}>
                        删除 ({historySelected.size})
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className={s.historyGrid}>
                {historyData?.items.map(item => (
                  <div key={item.id} style={{ position: 'relative' }}>
                    <input
                      type="checkbox"
                      style={{ position: 'absolute', top: 4, left: 4, width: 16, height: 16, cursor: 'pointer', zIndex: 1, accentColor: 'var(--orange-500)' }}
                      checked={historySelected.has(item.id)}
                      onChange={() => handleHistoryToggle(item.id)}
                    />
                    <img
                      className={s.historyImg}
                      src={getImgUrl(item.result_path)}
                      alt=""
                      onClick={() => handleHistoryClick(item)}
                      title={item.prompt}
                    />
                  </div>
                ))}
                {historyData?.items.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--gray-400)', padding: '20px 0', fontSize: 13 }}>
                    暂无历史图片
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={s.canvasArea}>
        {sourceImage && (
          <div className={s.editToolbar}>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="撤销 (Ctrl+Z)"
              style={historyIndex <= 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            ><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M4 8h8a4 4 0 010 8H8"/><path d="M7 5L4 8l3 3"/></svg> 撤销</button>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleRedo}
              disabled={historyIndex >= history.length - 1}
              title="重做 (Ctrl+Y)"
              style={historyIndex >= history.length - 1 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            ><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M16 8H8a4 4 0 000 8h4"/><path d="M13 5l3 3-3 3"/></svg> 重做</button>
            <button className="btn btn-outline btn-sm" onClick={handleRotateLeft} title="向左旋转90°"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M3 10a7 7 0 0112-5"/><path d="M3 3v4h4"/><path d="M17 10a7 7 0 01-12 5"/><path d="M17 17v-4h-4"/></svg> 左旋</button>
            <button className="btn btn-outline btn-sm" onClick={handleRotateRight} title="向右旋转90°"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M17 10a7 7 0 00-12-5"/><path d="M17 3v4h-4"/><path d="M3 10a7 7 0 0012 5"/><path d="M3 17v-4h4"/></svg> 右旋</button>
            <button className="btn btn-outline btn-sm" onClick={handleFlipH} title="水平翻转"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M4 10h12"/><path d="M4 6l-2 4 2 4"/><path d="M16 6l2 4-2 4"/></svg> 翻转H</button>
            <button className="btn btn-outline btn-sm" onClick={handleFlipV} title="垂直翻转"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M10 4v12"/><path d="M6 4l4-2 4 2"/><path d="M6 16l4 2 4-2"/></svg> 翻转V</button>
            {hasTransform && (
              <button className="btn btn-primary btn-sm" onClick={handleApplyTransform}>确认应用</button>
            )}
            {cropMode ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={handleCropConfirm}>确认裁剪</button>
                <button className="btn btn-outline btn-sm" onClick={handleCropCancel}>取消裁剪</button>
              </>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={handleCropStart}>裁剪</button>
            )}
            <button className="btn btn-outline btn-sm" onClick={handleResetTransform}>重置</button>
            <button className="btn btn-sm"
              style={{ background: compareMode ? 'var(--orange-500)' : 'var(--gray-100)', color: compareMode ? '#fff' : 'var(--gray-600)' }}
              onMouseDown={() => {
                setCompareOriginal(sourceImage?.url || null);
                setCompareMode(true);
              }}
              onMouseUp={() => setCompareMode(false)}
              onMouseLeave={() => { if (compareMode) setCompareMode(false); }}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="10" cy="10" r="3"/></svg> 对比
            </button>
            <span className={s.zoomBadge}>{Math.round(zoom * 100)}%</span>
            <button className="btn btn-primary btn-sm" onClick={() => handleOpenExport('single')} style={{ marginLeft: 'auto' }}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M13 2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7l-5-5z"/><path d="M13 2v5h5"/><path d="M7 13h6"/><path d="M7 16h4"/></svg> 导出
            </button>
          </div>
        )}
        <div
          className={`${s.canvasContainer} ${cropMode ? s.cropCursor : ''} ${isPanning ? s.panningCursor : ''}`}
          ref={canvasContainerRef}
          style={sourceImage ? {
            backgroundImage: 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%)',
            backgroundSize: '20px 20px',
          } : undefined}
          onDoubleClick={handleCanvasDblClick}
          onMouseDown={cropMode ? handleCropMouseDown : handlePanStart}
          onMouseMove={cropMode ? handleCropMouseMove : isPanning ? handlePanMove : undefined}
          onMouseUp={cropMode ? handleCropMouseUp : handlePanEnd}
          onMouseLeave={cropMode ? handleCropMouseUp : handlePanEnd}
        >
          {sourceImage ? (
            <div className={s.canvasImgWrapper} style={{ transform: imageTransform, width: canvasWidth || undefined, height: canvasHeight || undefined, border: canvasWidth && canvasHeight ? '2px dashed var(--gray-300)' : undefined, backgroundColor: canvasWidth && canvasHeight ? canvasBg : undefined }} data-canvas-area>
              {compareMode && compareOriginal ? (
                <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                  <img src={compareOriginal} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
                  <div style={{ position: 'absolute', top: 0, left: 0, width: `${compareSplit}%`, height: '100%', overflow: 'hidden' }}>
                    <img src={sourceImage.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ position: 'absolute', top: 0, left: `${compareSplit}%`, width: 2, height: '100%', background: '#fff', cursor: 'ew-resize', zIndex: 5 }}
                    onMouseDown={() => setCompareDragging(true)} />
                </div>
              ) : (
                <img
                  ref={sourceImgRef}
                  className={s.canvasImage}
                  src={sourceImage.url}
                  alt="源图片"
                  draggable={false}
                  style={{ filter: combinedFilter, width: canvasWidth ? '100%' : undefined, height: canvasHeight ? '100%' : undefined }}
                />
              )}
              {cropMode && cropRect.w > 0 && cropRect.h > 0 && (
                <div className={s.cropOverlay}>
                  <div
                    className={s.cropRect}
                    style={{
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.w,
                      height: cropRect.h,
                    }}
                  />
                </div>
              )}
              {sourceImage && watermarkText && (
                <div
                    style={{
                        position: 'absolute',
                        left: watermarkPos.x,
                        top: watermarkPos.y,
                        fontSize: watermarkSize,
                        color: watermarkColor,
                        opacity: watermarkOpacity / 100,
                        cursor: 'move',
                        userSelect: 'none',
                        pointerEvents: 'auto',
                        textShadow: '0 0 2px rgba(0,0,0,0.3)',
                        zIndex: 10,
                    }}
                    onMouseDown={(e) => {
                        setWatermarkDragging(true);
                        setWatermarkDragOffset({ x: e.clientX - watermarkPos.x, y: e.clientY - watermarkPos.y });
                    }}
                >
                    {watermarkText}
                </div>
              )}
              {sourceImage && labels.map(label => (
                <div
                  key={label.id}
                  style={{
                    position: 'absolute',
                    left: label.x,
                    top: label.y,
                    width: label.width,
                    height: label.height,
                    backgroundColor: label.bgColor,
                    color: label.color,
                    fontSize: label.fontSize,
                    fontWeight: 700,
                    borderRadius: label.borderRadius,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'move',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    border: selectedLabelId === label.id ? '2px solid #1890ff' : '2px solid transparent',
                    transform: `rotate(${label.rotation}deg)`,
                    zIndex: 10,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    padding: '0 6px',
                  }}
                  onMouseDown={(e) => handleLabelDragStart(label.id, e)}
                  onDoubleClick={() => handleLabelDoubleClick(label.id)}
                >
                  {label.text}
                  {selectedLabelId === label.id && (
                    <>
                      <div
                        style={{ position: 'absolute', right: -4, bottom: -4, width: 10, height: 10, background: '#1890ff', borderRadius: '50%', cursor: 'se-resize' }}
                        onMouseDown={(e) => handleLabelResizeStart(label.id, e)}
                      />
                      <div
                        style={{ position: 'absolute', right: -4, top: -4, width: 14, height: 14, background: '#ff4d4f', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', lineHeight: 1 }}
                        onClick={(e) => { e.stopPropagation(); handleDeleteLabel(label.id); }}
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:8,height:8}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={s.canvasEmpty}>
              <div className={s.canvasEmptyIcon}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:48,height:48}}>
                  <rect x="2" y="3" width="16" height="14" rx="2"/>
                  <path d="M2 13l4-4 3 3 4-5 5 6"/>
                  <circle cx="7" cy="7" r="1.5"/>
                </svg>
              </div>
              <div className={s.canvasEmptyText}>
                {batchMode
                  ? '在左侧搜索商品，展开后勾选需要批量编辑的图片'
                  : '从左侧选择素材图片，或上传本地图片开始编辑'}
              </div>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div className={s.resultSection}>
            <div className={s.resultHeader}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                生成结果 ({results.length})
              </span>
              {selectedResults.size > 0 && (
                <button className="btn btn-outline btn-sm" onClick={handleBatchDownload}>
                  批量下载 ({selectedResults.size})
                </button>
              )}
            </div>
            <div className={s.resultGrid}>
              {results.map((imgPath, idx) => (
                <div key={`${imgPath}-${idx}`} className={s.resultItem}>
                  <input
                    type="checkbox"
                    className={s.resultCheckbox}
                    checked={selectedResults.has(idx)}
                    onChange={() => handleToggleResultSelect(idx)}
                  />
                  <img
                    className={s.resultImg}
                    src={getImgUrl(imgPath)}
                    alt=""
                    onClick={() => setPreviewImage(getImgUrl(imgPath))}
                  />
                  <div className={s.resultActions}>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '3px 6px' }}
                      onClick={() => handleDownload(imgPath)}
                    >下载</button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '3px 6px' }}
                      onClick={() => handleApply(imgPath)}
                    >应用</button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '3px 6px' }}
                      onClick={() => handleContinueEdit(imgPath)}
                    >继续</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {batchMode && Object.keys(batchResults).length > 0 && (
          <div className={s.resultSection}>
            <div className={s.resultHeader}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                批量生成结果 ({Object.values(batchResults).reduce((sum, r) => sum + (r.urls || r.paths || []).length, 0)} 张)
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" onClick={handleBatchDownloadAll}>
                  全部下载
                </button>
                <button className="btn btn-outline btn-sm" onClick={handleBatchClearResults}>
                  清除结果
                </button>
              </div>
            </div>
            {Object.entries(batchResults).map(([imgUrl, result]) => {
              const truncated = imgUrl.length > 40 ? imgUrl.slice(0, 40) + '...' : imgUrl;
              const items = result.urls || result.paths || [];
              return (
                <div key={imgUrl} className={s.batchResultGroup}>
                  <div className={s.batchResultTitle} title={imgUrl}>
                    <img
                      src={imgUrl}
                      alt=""
                      style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{truncated}</span>
                    <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 'auto' }}>×{items.length} 张结果</span>
                    {result.error && <span style={{ color: 'var(--brand-red)', marginLeft: 8, fontWeight: 400 }}>{result.error}</span>}
                  </div>
                  {items.length > 0 ? (
                    <div className={s.batchResultImages}>
                      {items.map((p, i) => (
                        <img
                          key={i}
                          className={s.batchResultImg}
                          src={getImgUrl(p)}
                          alt=""
                          onClick={() => setPreviewImage(getImgUrl(p))}
                        />
                      ))}
                    </div>
                  ) : (
                    !result.error && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>无结果</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={s.rightPanel}>
        <div className={s.toolSection}>
          <div className={s.toolLabel}>工作模式</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`${s.presetBtn} ${!batchMode ? s.presetBtnActive : ''}`}
              onClick={() => { setBatchMode(false); setBatchSelected(new Set()); setBatchResults({}); setBatchExpandedProducts(new Set()); }}
              style={{ flex: 1 }}
            >单图编辑</button>
            <button
              className={`${s.presetBtn} ${batchMode ? s.presetBtnActive : ''}`}
              onClick={() => setBatchMode(true)}
              style={{ flex: 1 }}
            >批量作图</button>
          </div>
        </div>

        <div className={s.toolSection}>
          <div className={s.toolLabel}>编辑模式</div>
          <div className={s.toolMode}>
            <span className={s.toolModeDot} />
            <span>{sourceImage ? '图生图' : '文生图'}</span>
          </div>
        </div>

        {sourceImage && (
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-outline btn-sm" style={{ width: '100%' }}
              onClick={handleRemoveBg} disabled={removeBgMut.isPending}>
              {removeBgMut.isPending ? '处理中…' : <><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M2 13l4-4 3 3 4-5 5 6"/><circle cx="7" cy="7" r="1.5"/></svg> 移除背景</>}
            </button>
          </div>
        )}

        <div className={s.toolSection}>
          <div className={s.toolLabel}>预设模板</div>
          <div className={s.presetGrid}>
            {PRESET_KEYS.map(key => (
              <button
                key={key}
                className={`${s.presetBtn} ${selectedPreset === key ? s.presetBtnActive : ''}`}
                onClick={() => setSelectedPreset(prev => prev === key ? '' : key)}
              >
                {PRESET_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            onClick={() => setAdjustExpanded(!adjustExpanded)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}
          >
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><circle cx="10" cy="10" r="8"/><path d="M10 6v8"/><path d="M6 10h8"/></svg> 调整</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{adjustExpanded ? '▲' : '▼'}</span>
          </div>
          {adjustExpanded && sourceImage && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>
                  <span>亮度</span><span>{brightness}%</span>
                </div>
                <input type="range" min={0} max={200} value={brightness}
                  onChange={e => setBrightness(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--orange-500)' }} aria-label="亮度" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>
                  <span>对比度</span><span>{contrast}%</span>
                </div>
                <input type="range" min={0} max={200} value={contrast}
                  onChange={e => setContrast(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--orange-500)' }} aria-label="对比度" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>
                  <span>饱和度</span><span>{saturation}%</span>
                </div>
                <input type="range" min={0} max={200} value={saturation}
                  onChange={e => setSaturation(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--orange-500)' }} aria-label="饱和度" />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-outline btn-sm" style={{ flex: 1 }}
                  onClick={() => { setBrightness(100); setContrast(100); setSaturation(100); }}>
                  重置
                </button>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                  onClick={handleApplyAdjustments}>
                  应用
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setFilterExpanded(!filterExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2z"/><path d="M14 13l.75 2.25L17 16l-2.25.75L14 19l-.75-2.25L11 16l2.25-.75L14 13z"/></svg> 滤镜</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{filterExpanded ? '▲' : '▼'}</span>
          </div>
          {filterExpanded && sourceImage && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, paddingTop: 8 }}>
              {FILTER_PRESETS.map(f => (
                <button key={f.key} onClick={() => setActiveFilter(activeFilter === f.key ? null : f.key)}
                  style={{
                    padding: '6px 4px', fontSize: 11, textAlign: 'center', borderRadius: 6,
                    border: activeFilter === f.key ? '2px solid var(--orange-500)' : '1px solid var(--gray-200)',
                    background: 'var(--white)', cursor: 'pointer',
                  }}>
                  <div style={{ width: '100%', height: 40, borderRadius: 4, overflow: 'hidden', marginBottom: 4,
                    backgroundImage: 'repeating-conic-gradient(#e0e0e0 0% 25%, #fff 0% 50%)', backgroundSize: '8px 8px' }}>
                    <img src={sourceImage.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: f.css }} />
                  </div>
                  {f.name}
                </button>
              ))}
              {activeFilter && (
                <div style={{ gridColumn: 'span 3' }}>
                  <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={handleApplyFilter}>
                    应用滤镜
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setCanvasPresetExpanded(!canvasPresetExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M3 17l14-14"/><path d="M3 3h4v4"/><path d="M17 17h-4v-4"/></svg> 画布</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{canvasPresetExpanded ? '▲' : '▼'}</span>
          </div>
          {canvasPresetExpanded && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 8 }}>
                {CANVAS_PRESETS.map(p => (
                  <button key={p.name} className="btn btn-sm" style={{ fontSize: 11, textAlign: 'center', padding: '6px 4px' }}
                    onClick={() => { setCanvasWidth(p.w); setCanvasHeight(p.h); }}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input type="number" placeholder="宽" value={canvasWidth || ''} onChange={e => setCanvasWidth(Number(e.target.value))}
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="画布宽度" />
                <span style={{ color: 'var(--gray-400)', lineHeight: '28px' }}>×</span>
                <input type="number" placeholder="高" value={canvasHeight || ''} onChange={e => setCanvasHeight(Number(e.target.value))}
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} aria-label="画布高度" />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>背景:</span>
                <input type="color" value={canvasBg} onChange={e => setCanvasBg(e.target.value)}
                  style={{ width: 28, height: 28, border: 'none', cursor: 'pointer' }} aria-label="画布背景色" />
                <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setCanvasBg('#ffffff')}>白底</button>
                <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setCanvasBg('transparent')}>透明</button>
              </div>
            </div>
          )}
        </div>

        {sourceImage && (
        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setTextExpanded(!textExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M4 17l2-6L14.5 2.5a1 1 0 011.4 0l1.6 1.6a1 1 0 010 1.4L9 15l-5 2z"/><line x1="12.5" y1="4.5" x2="15.5" y2="7.5"/></svg> 水印</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{textExpanded ? '▲' : '▼'}</span>
          </div>
          {textExpanded && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>水印文字</label>
                <input value={watermarkText} onChange={e => setWatermarkText(e.target.value)}
                  placeholder="输入水印文字..."
                  style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>颜色</label>
                  <input type="color" value={watermarkColor} onChange={e => setWatermarkColor(e.target.value)}
                    style={{ width: '100%', height: 28, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>字号</label>
                  <input type="number" value={watermarkSize} onChange={e => setWatermarkSize(Number(e.target.value))} min={12} max={200}
                    style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>透明度: {watermarkOpacity}%</label>
                <input type="range" value={watermarkOpacity} onChange={e => setWatermarkOpacity(Number(e.target.value))} min={10} max={100}
                  style={{ width: '100%' }} />
              </div>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={handleApplyWatermark}>
                应用水印到图片
              </button>
            </div>
          )}
        </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setLabelsExpanded(!labelsExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><path d="M2 4l8-2 8 8-6 6-8-8V4z"/><circle cx="6" cy="6" r="1"/></svg> 标签</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{labelsExpanded ? '▲' : '▼'}</span>
          </div>
          {labelsExpanded && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 8 }}>
                {LABEL_TEMPLATES.map((tmpl, idx) => (
                  <button key={idx} className="btn btn-sm" style={{
                    fontSize: 11, textAlign: 'center', padding: '6px 4px',
                    background: tmpl.bgColor, color: tmpl.color, borderRadius: tmpl.borderRadius,
                    fontWeight: 700, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }} onClick={() => handleAddLabel(tmpl)}>
                    {tmpl.text}
                  </button>
                ))}
              </div>
              <button className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 4, marginBottom: 8, fontSize: 12 }}
                onClick={() => handleAddLabel({
                  type: 'promo', text: '自定义标签', fontSize: 14,
                  color: '#333333', bgColor: '#f0f0f0', borderRadius: 4,
                  width: 100, height: 32, rotation: 0,
                })}>
                + 添加自定义标签
              </button>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <input value={quickLabelText} onChange={e => setQuickLabelText(e.target.value)}
                  placeholder="输入自定义文字..."
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--gray-300)', borderRadius: 4, fontSize: 12 }} />
                <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => {
                    if (quickLabelText.trim()) {
                      handleAddLabel({
                        type: 'promo', text: quickLabelText.trim(), fontSize: 14,
                        color: '#ffffff', bgColor: '#ff4d4f', borderRadius: 4,
                        width: Math.max(80, quickLabelText.trim().length * 16), height: 32, rotation: 0,
                      });
                      setQuickLabelText('');
                    }
                  }}>
                  添加
                </button>
              </div>
              {labels.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleApplyLabels}>应用到图片</button>
                  <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={handleClearLabels}>清空</button>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 6 }}>点击添加标签，拖拽移动，双击编辑，选中后右下角可缩放</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setBgFillExpanded(!bgFillExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><circle cx="10" cy="10" r="8"/><path d="M10 6v8"/><path d="M6 10h8"/></svg> 换底色</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{bgFillExpanded ? '▲' : '▼'}</span>
          </div>
          {bgFillExpanded && sourceImage && (
            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>底色:</span>
                <input type="color" value={bgFillColor} onChange={e => setBgFillColor(e.target.value)}
                  style={{ width: 28, height: 28, border: 'none', cursor: 'pointer' }} />
                <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setBgFillColor('#ffffff')}>白色</button>
                <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setBgFillColor('#f5f5f5')}>浅灰</button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={bgFillGradient} onChange={e => setBgFillGradient(e.target.checked)} />
                  渐变
                </label>
                {bgFillGradient && (
                  <input type="color" value={bgFillGradientEnd} onChange={e => setBgFillGradientEnd(e.target.value)}
                    style={{ width: 28, height: 28, border: 'none', cursor: 'pointer' }} />
                )}
              </div>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={handleFillBackground}
                disabled={!sourceImage || bgFillLoading}>
                {bgFillLoading ? '处理中...' : '应用底色'}
              </button>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div onClick={() => setPlatformExpanded(!platformExpanded)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontWeight: 600, fontSize: 13 }}>
            <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,marginRight:4,verticalAlign:'middle'}}><rect x="5" y="1" width="10" height="18" rx="2"/><line x1="8" y1="16" x2="12" y2="16"/></svg> 适配</span>
            <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{platformExpanded ? '▲' : '▼'}</span>
          </div>
          {platformExpanded && sourceImage && (
            <div style={{ paddingTop: 8 }}>
              {PLATFORM_SIZES.map(ps => (
                <div key={ps.name} style={{ marginBottom: 10, padding: '6px 8px', background: 'var(--gray-100)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{ps.name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {ps.sizes.map(sz => (
                      <button key={`${ps.name}-${sz.label}`} className="btn btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}
                        onClick={() => handlePlatformAdapt(sz.w, sz.h)}>
                        {sz.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!batchMode && (
          <>
            <div className={s.toolSection}>
              <div className={s.toolLabel}>提示词</div>
              <textarea
                className={s.promptArea}
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder={selectedPreset ? `当前使用预设：${PRESET_LABELS[selectedPreset]}` : '描述你想要的图片效果...'}
              />
              <button
                className="btn btn-outline btn-sm"
                onClick={handleSuggestPrompt}
                disabled={suggestPromptMut.isPending}
                style={{ marginTop: 6, width: '100%', fontSize: 12 }}
              >
                {suggestPromptMut.isPending ? '正在分析图片...' : 'AI 帮我写提示词'}
              </button>
            </div>

            <div className={s.toolSection}>
              <div className={s.toolLabel}>分辨率</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                {RESOLUTIONS.map(r => (
                  <button
                    key={r.value}
                    className={`${s.ratioBtn} ${aspectRatio === r.value ? s.ratioBtnActive : ''}`}
                    onClick={() => setAspectRatio(r.value)}
                    style={{ fontSize: 11, padding: '5px 4px', lineHeight: 1.3 }}
                  >
                    <span style={{ display: 'block' }}>{r.value.split('x').join('×')}</span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={s.toolSection}>
              <div className={s.toolLabel}>生成数量</div>
              <div className={s.ratioGrid}>
                {[1, 2, 3, 4].map(n => (
                  <button
                    key={n}
                    className={`${s.ratioBtn} ${imageCount === n ? s.ratioBtnActive : ''}`}
                    onClick={() => setImageCount(n)}
                  >{n} 张</button>
                ))}
              </div>
            </div>

            <div className={s.toolSection}>
              <button
                className={`btn btn-primary ${s.generateBtn}`}
                disabled={!canGenerate}
                onClick={handleGenerate}
              >
                {generating ? '生成中...' : `开始生成${imageCount > 1 ? ` (${imageCount}张)` : ''}`}
              </button>
              {!isApiReady && (
                <div style={{ fontSize: 11, color: 'var(--brand-red)', marginTop: 6, textAlign: 'center' }}>
                  请先在设置中配置图片 API Key
                </div>
              )}
            </div>
          </>
        )}

        {batchMode && (
          <div className={s.toolSection}>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 8 }}>
              已选择 {batchSelected.size} 张图片，使用「{selectedPreset ? PRESET_LABELS[selectedPreset] : '未选择'}」模板
            </div>
            <button
              className={`btn btn-primary ${s.generateBtn}`}
              disabled={batchSelected.size < 1 || !selectedPreset || !isApiReady || batchGenerating}
              onClick={handleBatchGenerate}
            >
              {batchGenerating ? '批量生成中...' : `批量生成 (${batchSelected.size} 张)`}
            </button>
            {!isApiReady && (
              <div style={{ fontSize: 11, color: 'var(--brand-red)', marginTop: 6, textAlign: 'center' }}>
                请先在设置中配置图片 API Key
              </div>
            )}
            {!selectedPreset && (
              <div style={{ fontSize: 11, color: 'var(--orange-500)', marginTop: 6, textAlign: 'center' }}>
                请先选择预设模板
              </div>
            )}
          </div>
        )}
      </div>

      {previewImage && (
        <div className={s.modalOverlay} onClick={() => setPreviewImage(null)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <span>图片预览</span>
              <button className={s.modalClose} onClick={() => setPreviewImage(null)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:12,height:12}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg></button>
            </div>
            <div className={s.modalBody}>
              <img className={s.previewImage} src={previewImage} alt="预览" />
            </div>
          </div>
        </div>
      )}

      {applyModal.open && (
        <div className={s.modalOverlay} onClick={() => setApplyModal({ open: false, imagePath: '' })}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <span>应用到商品</span>
              <button className={s.modalClose} onClick={() => setApplyModal({ open: false, imagePath: '' })}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:12,height:12}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg></button>
            </div>
            <div className={s.modalBody}>
              <div className={s.applyModalBody}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 4 }}>搜索商品</div>
                  <input
                    value={applyKeyword}
                    onChange={e => setApplyKeyword(e.target.value)}
                    placeholder="输入商品关键词..."
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13, outline: 'none' }}
                  />
                  {applySearchResults && applySearchResults.length > 0 && (
                    <div className={s.applySearchResults}>
                      {applySearchResults.map(p => (
                        <div
                          key={p.goods_id}
                          className={`${s.applySearchItem} ${applyGoodsId === p.goods_id ? s.applySearchItemActive : ''}`}
                          onClick={() => { setApplyGoodsId(p.goods_id); setApplyKeyword(p.title); }}
                        >
                          {p.main_images[0] && (
                            <img className={s.applySearchThumb} src={p.main_images[0]} alt="" />
                          )}
                          <div className={s.applySearchTitle}>{p.title}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 6 }}>应用位置</div>
                  <div className={s.targetRadios}>
                    <label className={s.targetRadio}>
                      <input
                        type="radio"
                        name="applyTarget"
                        checked={applyTarget === 'main'}
                        onChange={() => setApplyTarget('main')}
                      />
                      主图
                    </label>
                    <label className={s.targetRadio}>
                      <input
                        type="radio"
                        name="applyTarget"
                        checked={applyTarget === 'detail'}
                        onChange={() => setApplyTarget('detail')}
                      />
                      详情图
                    </label>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!applyGoodsId || useImageMut.isPending}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={handleApplySubmit}
                >
                  {useImageMut.isPending ? '应用中...' : '确认应用'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingLabelId && (
        <div style={{ 
          position: 'fixed', right: 16, top: 80, zIndex: 2000, 
          background: '#fff', borderRadius: 12, padding: 16, width: 280,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid var(--gray-200)',
          maxHeight: 'calc(100vh - 100px)', overflowY: 'auto'
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>编辑标签</span>
            <span style={{ cursor: 'pointer', fontSize: 18, color: 'var(--gray-400)', lineHeight: 1 }} onClick={() => setEditingLabelId(null)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:14,height:14}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg></span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>文字内容</label>
            <input value={editLabelText} onChange={e => setEditLabelText(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', border: '1px solid var(--gray-300)', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>文字颜色</label>
              <input type="color" value={editLabelColor} onChange={e => setEditLabelColor(e.target.value)}
                style={{ width: '100%', height: 28, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>背景颜色</label>
              <input type="color" value={editLabelBgColor} onChange={e => setEditLabelBgColor(e.target.value)}
                style={{ width: '100%', height: 28, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>字号: {editLabelFontSize}px</label>
            <input type="range" min={10} max={72} value={editLabelFontSize} onChange={e => setEditLabelFontSize(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>宽度: {editLabelWidth}px</label>
              <input type="range" min={40} max={400} value={editLabelWidth} onChange={e => setEditLabelWidth(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>高度: {editLabelHeight}px</label>
              <input type="range" min={20} max={200} value={editLabelHeight} onChange={e => setEditLabelHeight(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>圆角: {editLabelBorderRadius}px</label>
              <input type="range" min={0} max={50} value={editLabelBorderRadius} onChange={e => setEditLabelBorderRadius(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--gray-500)', display: 'block', marginBottom: 3 }}>旋转: {editLabelRotation}°</label>
              <input type="range" min={-45} max={45} value={editLabelRotation} onChange={e => setEditLabelRotation(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setEditingLabelId(null)}>完成</button>
          </div>
        </div>
      )}

      {exportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 3000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setExportModal(false)}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 24, width: 400,
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16,marginRight:6,verticalAlign:'middle'}}><path d="M13 2H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7l-5-5z"/><path d="M13 2v5h5"/><path d="M7 13h6"/><path d="M7 16h4"/></svg> 导出图片</span>
              <span style={{ cursor: 'pointer', fontSize: 20, color: 'var(--gray-400)', lineHeight: 1 }} onClick={() => setExportModal(false)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:16,height:16}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg></span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>格式</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['png', 'jpeg', 'webp'] as const).map(fmt => (
                  <button key={fmt}
                    className={`btn btn-sm ${exportFormat === fmt ? 'btn-primary' : 'btn-outline'}`}
                    style={{ flex: 1, fontSize: 12 }}
                    onClick={() => setExportFormat(fmt)}>
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                {exportFormat === 'png' ? '无损压缩，文件较大，支持透明' :
                 exportFormat === 'jpeg' ? '有损压缩，文件较小，不支持透明' :
                 '现代格式，压缩率高，兼容性稍差'}
              </div>
            </div>

            {exportFormat !== 'png' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>
                  质量: {exportQuality}%
                </label>
                <input type="range" min={10} max={100} value={exportQuality}
                  onChange={e => setExportQuality(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gray-400)' }}>
                  <span>小文件</span><span>高质量</span>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 6 }}>
                缩放: {exportScale}%
              </label>
              <input type="range" min={25} max={200} value={exportScale}
                onChange={e => setExportScale(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--orange-500)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gray-400)' }}>
                <span>25%</span><span>100%</span><span>200%</span>
              </div>
            </div>

            <div style={{ background: 'var(--gray-50)', borderRadius: 8, padding: 10, marginBottom: 16, fontSize: 12, color: 'var(--gray-500)' }}>
              <div>导出内容: {exportTarget === 'batch' ? `批量结果 (${Object.values(batchResults).reduce((s, r) => s + (r.urls || r.paths || []).length, 0)} 张)` :
                results.length > 0 ? `生成结果 (${results.length} 张)` : '当前编辑图片'}</div>
              <div>输出格式: {exportFormat.toUpperCase()} {exportFormat !== 'png' ? `· 质量 ${exportQuality}%` : ''} · 缩放 {exportScale}%</div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setExportModal(false)}>取消</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleExportConfirm}>
                确认导出
              </button>
            </div>
          </div>
        </div>
      )}

      {historyDeleteConfirm && (
        <div className={s.modalOverlay} onClick={() => setHistoryDeleteConfirm(false)}>
          <div className={s.modalContent} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <span>确认删除</span>
              <button className={s.modalClose} onClick={() => setHistoryDeleteConfirm(false)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{width:12,height:12}}><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg></button>
            </div>
            <div className={s.modalBody}>
              <p>确定要删除选中的 {historySelected.size} 张历史图片吗？此操作不可撤销。</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn btn-outline" onClick={() => setHistoryDeleteConfirm(false)}>取消</button>
                <button className="btn btn-primary" style={{ background: 'var(--brand-red)' }} onClick={handleHistoryDelete} disabled={deleteHistMut.isPending}>
                  {deleteHistMut.isPending ? '删除中...' : '确认删除'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
