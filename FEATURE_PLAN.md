# PDD 采集系统 — 功能扩展开发计划书

> 基于现有代码库实际状态 + 微信小店官方 API 文档（developers.weixin.qq.com）编写
> 编写日期：2026-06-08

---

## 一、项目现状盘点

### 1.1 已有模块与代码量

| 模块 | 文件 | 核心能力 |
|------|------|----------|
| 代理拦截 | `service.py` (212行) | mitmproxy 插件，注入 JS 提取数据，拦截价格 API |
| JS 注入 | `inject.js` | Hook JSON.parse/XHR/fetch/MutationObserver/React Fiber |
| 数据导出 | `exporter.py` (425行) | JSON/CSV/Excel/TXT+图片ZIP/淘宝格式，共 6 种 |
| Web 后台 | `web/app.py` (400+行) | Flask + React SPA，商品 CRUD/标签/分组/批量操作/导出/打包 |
| AI 功能 | `web/ai.py` | grsai 图片生成/编辑 + LLM 文案改写（4种平台风格） |
| 数据库 | SQLite 6 张表 | goods(23字段)/tags/groups/ai_images 及关联表 |
| 前端 | `frontend/dist/` | React SPA，仪表盘/商品列表/商品详情/导出/设置 |

### 1.2 当前采集的字段（来自 service.py + exporter.py 实际代码）

```
goods_id, title, subtitle, selling_points, price, original_price,
min_group_price, sales, sold_quantity, shop_name, shop_id, shop_logo,
main_images, detail_images, sku_images, specs, skus, description,
attributes, source_url, crawl_time, updated_at, raw_data
```

**共 23 个字段**，其中 `skus` 内部包含：`sku_id, price, stock, image, specs`

### 1.3 当前导出格式（来自 exporter.py 实际代码）

| 函数 | 格式 | 用途 |
|------|------|------|
| `export_json()` | JSON | 通用数据交换 |
| `export_csv()` | CSV (UTF-8 BOM) | 表格查看 |
| `export_excel()` | .xlsx (openpyxl) | 表格查看/导入 |
| `export_for_taobao()` | JSON | 淘宝/1688 上货 |
| `export_txt()` | TXT + 图片 ZIP | 上货参考 |
| `api_package()` | 图片+JSON+AI图 ZIP | 完整数据包 |

---

## 二、目标：拼多多采集 → 微信小店上架

### 2.1 微信小店"添加商品" API 字段要求

来源：https://developers.weixin.qq.com/doc/store/shop/API/channels-shop-product/shop/api_addproduct.html

| API 字段 | 类型 | 必填 | 说明 |
|----------|------|------|------|
| `title` | string | 是 | 商品标题，最多60字符，至少5个有效字符 |
| `head_imgs` | array | 是 | 主图 3~9 张，需先通过上传接口转存 |
| `desc_info.imgs` | array | 是 | 详情图 1~50 张 |
| `desc_info.desc` | string | 否 | 详情文本 |
| `cats` / `cats_v2` | array | 是 | 类目ID（一/二/三级），需从微信类目接口获取 |
| `attrs` | array | 否 | 商品属性（attr_key + attr_value） |
| `skus` | array | 是 | SKU 列表，1~500 个 |
| `skus[].sale_price` | number | 否 | 售价，单位：**分** |
| `skus[].stock_num` | number | 是 | 库存 |
| `skus[].sku_attrs` | array | 否 | 规格（attr_key + attr_value） |
| `skus[].thumb_img` | string | 否 | SKU 小图 URL |
| `deliver_method` | number | 是 | 发货方式：0=快递，1=无需快递，3=账号发货 |
| `extra_service` | object | 是 | 七天无理由退货、运费险等售后设置 |
| `express_info` | object | 否 | 运费模板ID + 商品重量 |
| `head_videos` | object | 否 | 主图视频（最多1个） |
| `brand_id` | string | 否 | 品牌ID，无品牌填 "2100000000" |
| `spu_code` | string | 否 | 商家编码 |
| `listing` | number | 否 | 添加后是否立即上架（1=是） |

### 2.2 数据映射分析

| 微信小店字段 | 你已有的数据 | 映射方式 | 难度 |
|-------------|-------------|---------|------|
| `title` | `goods.title` | 截断至60字符，去除违禁词 | 低 |
| `head_imgs` | `goods.main_images` | 下载后上传到微信服务器，获取微信URL | 中 |
| `desc_info.imgs` | `goods.detail_images` | 同上 | 中 |
| `desc_info.desc` | `goods.description` | 直接使用 | 低 |
| `cats` | ❌ 无 | 需人工映射或调用微信推荐API | **高** |
| `attrs` | `goods.attributes` | key/value 格式匹配微信属性 | 中 |
| `skus[].sale_price` | `goods.price` | ×100 转为"分" | 低 |
| `skus[].stock_num` | `goods.skus[].stock` | 直接使用（无库存时默认999） | 低 |
| `skus[].sku_attrs` | `goods.specs` | 格式转换 | 低 |
| `skus[].thumb_img` | `goods.sku_images` | 下载后上传到微信服务器 | 中 |
| `deliver_method` | ❌ 无 | 用户配置，默认0（快递） | 低 |
| `extra_service` | ❌ 无 | 用户配置默认值 | 低 |
| `express_info` | ❌ 无 | 用户配置运费模板 | 低 |
| `head_videos` | ❌ 无 | 当前未采集视频 | **高** |

**结论：你现有的 23 个字段覆盖了微信小店约 70% 的必填需求。**

### ⚠️ 微信小店 API 关键约束（已从官方文档核实）

1. **图片必须先上传到微信服务器** — 官方原文："图片相关参数，请务必使用接口上传图片（resp_type=1），并将返回的img_url填入此处，**不接受其他任何格式的图片url**"。这意味着纯 Excel 导出方案中，图片需要用户手动在微信小店后台上传。
2. **添加商品 = 创建草稿** — 官方原文："调用接口新增和修改商品数据后，影响的只是草稿数据，**要调上架接口，并审核通过**，草稿数据才会覆盖线上数据正式生效"。
3. **价格单位是"分"** — `sale_price` 以分为单位（如 29.90 元 = 2990 分）。
4. **`cats` 必须恰好 3 个元素** — 一/二/三级类目 ID，上架后不可修改一级类目。
5. **新旧类目树并存** — `cats`（旧，固定三级）和 `cats_v2`（新，多级）可选其一，建议用 `cats_v2`。
6. **`head_imgs` 最少 3 张**（食品饮料和生鲜类目最少 4 张），最多 9 张，无尺寸要求。
7. **`skus[].stock_num` 是必填**，无库存数据时需要设默认值。
8. **`extra_service` 有两个子字段必填**：`seven_day_return`（七天无理由退货：0/1/2/3）和 `freight_insurance`（运费险：0/1）。
9. **`deliver_acct_type`** — 仅当 `deliver_method=3`（账号发货）时需要，快递发货（0）不需要。
10. **SKU 数量超过 25 个时接口会异步处理**。

---

## 三、功能开发计划（共五期）

### 第一期：微信小店数据包导出（核心，预计 3~5 天）

**目标**：在现有导出模块中新增微信小店专用导出，生成 Excel 数据表 + 图片 ZIP 数据包。用户在微信小店后台手动导入图片和填写信息时可直接参考。

> **说明**：由于微信小店 API 不接受外部图片 URL，且后台的"批量导入"Excel 模板仅在微信小店管理后台内可下载（官方未公开模板格式），因此一期方案定位为**辅助数据包**——帮用户把数据和图片整理好，方便手动上架或配合第三方工具使用。

#### 任务清单

| 序号 | 任务 | 涉及文件 | 工作内容 |
|------|------|---------|---------|
| 1.1 | 导出函数 | `exporter.py` | 新增 `export_for_wec(goods_ids)` 函数 |
| 1.2 | Excel 数据表 | `exporter.py` | 生成包含微信小店必填字段的 Excel |
| 1.3 | 标题处理 | `exporter.py` | 自动截断至60字，去除违规字符（如√、Ⅲ等） |
| 1.4 | 价格处理 | `exporter.py` | 保留元单位（Excel 中显示元），同时标注对应的分值 |
| 1.5 | 规格转换 | `exporter.py` | `{颜色: [白,黑]}` → 微信小店 sku_attrs 格式 `[{attr_key:"颜色", attr_value:"白色"}, ...]` |
| 1.6 | 图片下载打包 | `exporter.py` | 多线程下载主图+详情图，按商品分文件夹打ZIP |
| 1.7 | SKU 展开 | `exporter.py` | 将 `skus` 数组展开为微信小店要求的格式 |
| 1.8 | Web 后台入口 | `web/app.py` | 导出 API 新增 `format=wechat` |
| 1.9 | 前端适配 | `frontend/` | 导出页面下拉菜单新增"微信小店"选项 |

**导出的 Excel 列结构：**

| 列名 | 数据来源 | 示例 |
|------|---------|------|
| 商品名称 | `title`（截断60字） | "夏季新款男士短袖T恤..." |
| 价格(元) | `price` | 29.90 |
| 划线价(元) | `original_price` | 59.90 |
| 库存 | `skus[].stock` | 999（默认值） |
| 规格组合 | `specs` 展开 | "颜色:白色 尺码:XL" |
| 主图文件夹 | `main_images` 下载 | "主图_1.jpg 主图_2.jpg" |
| 详情图文件夹 | `detail_images` 下载 | "详情图_1.jpg" |
| 商品描述 | `description` | "本品采用优质面料..." |
| 商品属性 | `attributes` | "材质:纯棉; 适用季节:夏季" |
| 原始商品ID | `goods_id` | "1234567890" |
| 来源链接 | `source_url` | "https://mobile.yangkeduo.com/..." |

**导出的 ZIP 结构：**

```
微信小店数据包_20260608/
├── 商品数据.xlsx
├── goods.json
└── 图片/
    ├── 1234567890_夏季男士T恤/
    │   ├── 主图/
    │   │   ├── 主图_1.jpg
    │   │   ├── 主图_2.jpg
    │   │   └── 主图_3.jpg
    │   └── 详情图/
    │       ├── 详情图_1.jpg
    │       └── 详情图_2.jpg
    └── 9876543210_另一款商品/
        └── ...
```

---

### 第二期：图片批量处理（预计 5~7 天）

**目标**：补齐图片处理能力，对标甩手工具箱的修图功能。

| 序号 | 功能 | 说明 |
|------|------|------|
| 2.1 | 批量加水印 | 文字/图片水印，支持位置、透明度、字体 |
| 2.2 | 一键白底图 | 调用已有 grsai API 的 white_bg 预设 |
| 2.3 | 批量去水印 | 调用已有 grsai API 的 remove_watermark 预设 |
| 2.4 | 图片尺寸裁剪 | 按微信小店推荐尺寸裁剪 |
| 2.5 | Web 批量操作 | 商品列表勾选 → 批量处理图片 |

**依赖**：需新增 `Pillow` 库。

---

### 第三期：价格监控与变动追踪（预计 5~7 天）

**目标**：记录商品价格历史，支持价格走势查看。

| 序号 | 任务 | 工作内容 |
|------|------|---------|
| 3.1 | 数据库 | 新增 `price_history` 表 |
| 3.2 | 数据采集 | `save_goods_from_api()` 中记录每次价格变动 |
| 3.3 | 查询 API | `GET /api/product/<id>/price-history` |
| 3.4 | 前端图表 | 商品详情页新增价格走势折线图 |

**新增数据库表：**

```sql
CREATE TABLE price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goods_id TEXT NOT NULL,
    price REAL NOT NULL,
    min_group_price REAL,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (goods_id) REFERENCES goods(goods_id)
);
```

---

### 第四期：评价数据抓取与分析（预计 7~10 天）

**目标**：拦截拼多多评价 API，抓取评价内容并提供基础分析。

| 序号 | 任务 | 工作内容 |
|------|------|---------|
| 4.1 | 评价拦截 | mitmproxy 拦截评价 API 响应 |
| 4.2 | 评价存储 | 新增 `comments` 表 |
| 4.3 | 评价展示 | 商品详情页新增评价列表 |
| 4.4 | 关键词提取 | 从评价中提取高频词 |
| 4.5 | 情感分类 | 基于关键词的正/负面标记 |

**新增数据库表：**

```sql
CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goods_id TEXT NOT NULL,
    content TEXT,
    rating INTEGER,
    images TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (goods_id) REFERENCES goods(goods_id)
);
```

---

### 第五期：数据可视化仪表盘（预计 3~5 天）

**目标**：在现有仪表盘基础上增加数据图表。

| 图表 | 数据来源 | 类型 |
|------|---------|------|
| 采集趋势 | `crawl_time` 按天统计 | 折线图 |
| 价格分布 | `price` 字段 | 直方图 |
| 销量排行 | `sales` TOP10 | 柱状图 |
| 店铺分布 | `shop_name` 统计 | 饼图 |

**前端依赖**：需引入 Chart.js 或 ECharts。

---

## 四、优先级与排期

| 期次 | 功能 | 优先级 | 预估工时 |
|------|------|--------|---------|
| **一期** | 微信小店导出模板 | 🔴 最高 | 3~5 天 |
| **二期** | 图片批量处理 | 🔴 高 | 5~7 天 |
| **三期** | 价格监控 | 🟡 中 | 5~7 天 |
| **四期** | 评价分析 | 🟡 中 | 7~10 天 |
| **五期** | 数据可视化 | 🟢 低 | 3~5 天 |

**总计预估**：23~34 天（单人开发）

---

## 五、技术风险与注意事项

### 5.1 微信小店类目映射（一期最大难点）

拼多多和微信小店的类目体系完全不同，无法自动转换。微信小店类目通过 `GET /channels/ec/product/category/allcategory` 获取。

**解决方案：**
1. **人工映射表**：维护 `pdd_category → wechat_category_id` 的 JSON 映射文件
2. **初始覆盖**：先覆盖你店铺常用的 30~50 个类目
3. **用户补充**：在 Web 后台提供类目映射管理界面
4. **后续优化**：接入微信「类目推荐」API（`/channels/ec/product/category/classify`），根据标题+主图自动推荐类目

### 5.2 图片转存（一期/二期涉及）

微信小店 API **不接受外部图片 URL**（官方原文已确认）。所有图片必须：
1. 调用微信上传接口：`POST /channels/media/uploadimg?access_token=TOKEN`（参数 `resp_type=1`）
2. 获取返回的 `img_url`（前缀为 `mmecimage.cn/p/` 的 URL 可直接使用）

一期方案中图片以 ZIP 打包下载，由用户手动上传。如需全自动铺货（二期），需对接微信 API。

### 5.3 商品审核机制

微信小店商品有草稿/线上两份数据：
- 调用添加/更新 API → 只修改草稿
- 需要调用上架接口 → 提交审核 → 审核通过后才正式生效
- 可通过 `release_mode=1`（极简模式）跳过部分审核

### 5.4 当前未采集的数据

| 数据 | 是否需要补充 | 说明 |
|------|------------|------|
| 商品视频 | ⚠️ 建议补充 | 微信小店支持主图视频（最多1个），当前 inject.js 未提取 |
| 详细库存 | ⚠️ 部分缺失 | 某些 SKU 只有价格没有库存，需设默认值 |
| 商品重量 | ⚠️ 部分缺失 | 用于运费计算（`express_info.weight`，单位克），存在 `attributes` 中但不保证有 |
| 类目信息 | ❌ 无法采集 | 拼多多类目 ID 未暴露在前端数据中，需人工映射 |
| 品牌信息 | ⚠️ 部分有 | `attributes` 中可能有品牌，但需匹配微信小店的 `brand_id` |

---

## 六、不做的事情（明确边界）

- ❌ 整店批量采集（需要店铺授权或爬虫，风控风险高）
- ❌ 多平台同时采集（当前只做拼多多）
- ❌ 微信小店 API 直接上架（需要企业资质 + 开发者审核）
- ❌ 订单管理和发货（属于 ERP 系统范畴）
- ❌ 1688 代发对接（属于供应链系统范畴）

---

## 七、验收标准

### 一期验收

- [ ] Web 后台导出菜单出现"微信小店"选项
- [ ] 导出 Excel 包含微信小店要求的所有必填列
- [ ] 标题自动截断至 60 字符
- [ ] 价格正确显示
- [ ] 规格组合正确展开
- [ ] 图片正确下载并按商品分文件夹
- [ ] 导出 ZIP 在另一台电脑可正常打开
