# Tasks

- [x] Task 1: 历史图片批量操作 - 后端API
  - [x] SubTask 1.1: 在 app.py 中添加 DELETE /api/ai/history 端点，支持批量删除历史图片
  - [x] SubTask 1.2: 在 api/index.ts 中添加 deleteAiHistory API 函数
  - [x] SubTask 1.3: 在 useApi.ts 中添加 useDeleteAiHistory hook

- [x] Task 2: 历史图片批量操作 - 前端UI
  - [x] SubTask 2.1: 在 AiEditor.tsx 的历史图片标签页添加选中状态管理
  - [x] SubTask 2.2: 添加全选/取消全选按钮
  - [x] SubTask 2.3: 添加导出按钮（复用现有导出功能）
  - [x] SubTask 2.4: 添加删除按钮和确认弹窗
  - [x] SubTask 2.5: 添加历史图片的复选框UI

- [x] Task 3: 修复批量作图上传bug
  - [x] SubTask 3.1: 检查 handleFileUpload 函数是否支持多文件
  - [x] SubTask 3.2: 修改文件输入框支持 multiple 属性
  - [x] SubTask 3.3: 修改拖拽上传支持多文件
  - [x] SubTask 3.4: 优化上传后的图片列表展示

- [x] Task 4: 设置页面清空按钮
  - [x] SubTask 4.1: 在图片模型配置区添加清空按钮
  - [x] SubTask 4.2: 在文本模型配置区添加清空按钮
  - [x] SubTask 4.3: 实现清空逻辑（清空输入框内容）

- [x] Task 5: 设置页面体验优化
  - [x] SubTask 5.1: 添加配置状态指示器（已配置/未配置）
  - [x] SubTask 5.2: 添加配置说明文字和帮助提示
  - [x] SubTask 5.3: 优化布局和视觉层次

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 独立
- Task 4 独立
- Task 5 独立
