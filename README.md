# PDD Spider - 拼多多商品采集与电商图片编辑工具

> 一站式拼多多商品数据采集 + AI 图片编辑 + 多平台文案改写的电商运营工具

## 功能特性

### 数据采集

- **自动采集** - 通过 MITM 代理拦截拼多多页面，自动提取商品标题、价格、图片、规格、SKU 等全量数据
- **智能解析** - 价格分/元自动识别，SKU 多维度规格解析（颜色分类+尺码等），图片去重
- **后台管理** - Web 管理界面，支持搜索、分页、分组筛选、标签筛选

### AI 图片编辑器

| 功能 | 说明 |
|------|------|
| 标签系统 | 12 种电商预设标签（7天无理由/包邮/新品上市等），支持拖拽、缩放、双击编辑、实时预览 |
| 滤镜 | 清新/复古/高对比/暖色/冷色/黑白等预设，一键应用 |
| 调色 | 亮度/对比度/饱和度滑块实时预览 |
| 裁剪 | 框选区域自由裁剪 |
| 变换 | 左旋/右旋/水平翻转/垂直翻转/缩放/平移 |
| 水印 | 自定义文字/颜色/字号/透明度，位置可拖拽 |
| 换底色 | 纯色/渐变填充，适配白底图需求 |
| 平台适配 | 一键设为拼多多/淘宝/抖音/小红书标准尺寸 |
| 分辨率 | 8 种电商常用分辨率（512x512 ~ 1920x1080） |
| 导出 | PNG/JPEG/WEBP 格式，可调质量 (10-100%) 和缩放 (25-200%) |

### AI 文案生成

- **智能改写** - 基于 OpenAI 兼容 API，自动改写商品标题、卖点、描述
- **多平台风格** - 适配淘宝/抖音/拼多多/小红书等不同平台的文案风格
- **批量生成** - 一次生成标题、副标题、卖点、详情全套文案

### 数据导出

- JSON / CSV / Excel / TXT 四种格式
- TXT 图文包包含商品信息 + 实际图片打包
- 支持批量导出 AI 生成图片

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+（仅开发构建需要）

### 安装

```bash
# 克隆项目
git clone https://github.com/yourname/pdd-spider.git
cd pdd-spider

# 安装后端依赖
cd pdd_proxy
pip install -r requirements.txt

# 安装 mitmproxy CA 证书（首次使用，需管理员权限）
# 在项目根目录右键以管理员身份运行 install_cert.bat（证书不存在时会自动生成）
..\install_cert.bat

# 安装前端依赖并构建
cd ../frontend
npm install
npm run build

# 将构建产物复制到后端静态目录
cp -r dist/* ../pdd_proxy/frontend/dist/
```

### 启动

```bash
cd pdd_proxy

# 启动代理服务 + Web 后台
python start.py
```

启动后：

1. 浏览器会自动打开拼多多，登录账号
2. 正常浏览商品详情页，数据自动采集
3. 访问 `http://127.0.0.1:5000` 查看采集结果

### 配置 AI 功能（可选）

在 Web 后台的「设置」页面配置：

- **图片 API** - grsai API Key（用于 AI 图片生成/编辑）
- **文本 API** - OpenAI 兼容 API Key + Base URL（用于文案改写）

## 目录结构

```
pdd-spider/
├── pdd_proxy/
│   ├── start.py              # 主启动入口
│   ├── service.py            # MITM 代理拦截逻辑 + 数据库初始化
│   ├── inject.js             # 注入到拼多多页面的 JS 采集脚本
│   ├── exporter.py           # 数据导出模块
│   ├── storage.py            # 数据存储模块
│   ├── parser.py             # 数据解析模块
│   ├── web/
│   │   ├── app.py            # Flask Web API 服务
│   │   └── ai.py             # AI 图片/文案服务模块
│   ├── frontend/dist/        # React 前端构建产物
│   └── data/                 # 运行时数据（数据库、图片等）
├── frontend/
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   ├── hooks/            # React Query Hooks
│   │   ├── api/              # API 客户端
│   │   ├── styles/           # CSS 样式
│   │   └── types.ts          # TypeScript 类型定义
│   ├── package.json
│   └── vite.config.ts
├── 说明文档 先看这里！！！！！.txt
└── README.md
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 代理层 | mitmproxy (Python) |
| 后端 | Python 3.12 / Flask / SQLite / Pillow |
| 前端 | React 18 / TypeScript / Vite / React Query / Axios |
| AI 图片 | grsai API（流式 SSE） |
| AI 文本 | OpenAI 兼容 API |

## 工作原理

```
┌─────────┐     HTTPS      ┌──────────────┐     HTTP      ┌─────────┐
│ 浏览器   │ ──────────────→ │ MITM 代理     │ ─────────────→ │ 拼多多   │
│ (用户)   │ ←────────────── │ :8080        │ ←───────────── │ 服务器   │
└─────────┘                 │              │                └─────────┘
                            │ inject.js    │
                            │ 注入采集脚本  │
                            └──────┬───────┘
                                   │ POST /api/ingest
                            ┌──────▼───────┐
                            │ Flask 后端    │
                            │ :5000        │
                            │              │
                            │ ┌──────────┐ │
                            │ │ SQLite   │ │
                            │ │ goods.db │ │
                            │ └──────────┘ │
                            └──────┬───────┘
                                   │
                            ┌──────▼───────┐
                            │ React 前端   │
                            │ 管理后台     │
                            └──────────────┘
```

1. **代理拦截** - mitmproxy 在 `:8080` 开启 HTTPS 代理，拦截拼多多请求
2. **脚本注入** - 检测到商品页面后注入 `inject.js`，拦截 API 响应 + 监听 DOM 变化
3. **数据存储** - 采集到的数据通过 `/api/ingest` 存入 SQLite
4. **Web 管理** - Flask 后端提供 RESTful API，React 前端提供管理界面

## 常见问题

**Q: 浏览器提示证书错误？**
A: 以管理员身份运行 `install_cert.bat` 安装 CA 证书（证书文件不存在时脚本会自动生成）。macOS/Linux 可手动将 `pdd_proxy/certs/mitmproxy-ca-cert.pem` 导入系统受信任根证书。

**Q: 采集不到商品数据？**
A: 确保系统代理已设置为 `127.0.0.1:8080`，且浏览器使用系统代理。建议用无痕模式。

**Q: AI 功能报错？**
A: 在「设置」页面检查 API Key 是否配置正确，点击「测试」验证连通性。

**Q: 图片加载不出来？**
A: 拼多多图片有 Referer 防盗链，本工具已内置绕过方案。如仍有问题，检查代理是否正常运行。

## 免责声明

- 本工具仅供学习和研究使用
- 采集的数据版权归原商品所有者所有
- 请遵守相关法律法规，不得用于非法用途
- 使用 AI 功能需要自行配置有效的 API Key

## 作者


- 2856612799@qq.com
