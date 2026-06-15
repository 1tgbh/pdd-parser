import { describe, it, expect } from 'vitest';
import type { GoodsInfo, SkuItem, SkuSpec, DashboardStats, AutoTaskStatus } from '../types';

describe('TypeScript 类型定义', () => {
  it('SkuSpec 结构正确', () => {
    const spec: SkuSpec = { key: '颜色', value: '红色' };
    expect(spec.key).toBe('颜色');
    expect(spec.value).toBe('红色');
  });

  it('SkuItem 结构正确', () => {
    const sku: SkuItem = {
      sku_id: 's1',
      price: 19.9,
      original_price: 29.9,
      stock: 100,
      specs: [{ key: '颜色', value: '红' }],
      image: 'https://img.example.com/1.jpg',
      barcode: '123456',
    };
    expect(sku.sku_id).toBe('s1');
    expect(sku.price).toBe(19.9);
    expect(sku.specs).toHaveLength(1);
  });

  it('GoodsInfo 结构正确', () => {
    const g: GoodsInfo = {
      goods_id: 'test_001',
      title: '测试商品',
      subtitle: '副标题',
      selling_points: ['卖点1', '卖点2'],
      price: 9.9,
      original_price: 19.9,
      min_group_price: 8.9,
      sales: 1000,
      sold_quantity: 500,
      shop_name: '测试店铺',
      shop_id: 'shop_001',
      shop_logo: '',
      main_images: ['https://img.example.com/1.jpg'],
      detail_images: [],
      sku_images: [],
      specs: { 颜色: ['红', '蓝'] },
      skus: [],
      description: '商品描述',
      attributes: {},
      source_url: 'https://pdd.com/goods/123',
      crawl_time: '2026-06-05T10:00:00',
    };
    expect(g.goods_id).toBe('test_001');
    expect(g.selling_points).toHaveLength(2);
    expect(g.specs['颜色']).toEqual(['红', '蓝']);
  });

  it('DashboardStats 结构正确', () => {
    const stats: DashboardStats = {
      total_goods: 100,
      today_goods: 5,
      shop_count: 10,
      recent: [],
      shop_distribution: { '店铺A': 20 },
    };
    expect(stats.total_goods).toBe(100);
    expect(stats.shop_distribution['店铺A']).toBe(20);
  });

  it('AutoTaskStatus 结构正确', () => {
    const status: AutoTaskStatus = {
      running: true,
      progress: 3,
      total: 10,
      message: '采集中',
      logs: ['[10:00:00] 开始'],
    };
    expect(status.running).toBe(true);
    expect(status.progress).toBe(3);
  });
});
