# AI编辑器与设置页面改进 Spec

## Why
用户在使用AI编辑器的历史图片功能时缺乏批量操作能力，批量作图存在上传限制bug，设置页面的用户体验需要优化。

## What Changes
- AI编辑器历史图片新增全选、导出、删除按钮
- 修复批量作图只能上传一张图片的bug
- 设置页面新增清空按钮，优化整体用户体验

## Impact
- Affected specs: AI编辑器、设置页面
- Affected code: AiEditor.tsx, Settings.tsx, useApi.ts, api/index.ts, app.py

## ADDED Requirements

### Requirement: 历史图片批量操作
AI编辑器的历史图片标签页 SHALL 提供全选、导出、删除功能。

#### Scenario: 全选历史图片
- **WHEN** 用户点击"全选"按钮
- **THEN** 所有历史图片被选中，按钮变为"取消全选"

#### Scenario: 导出选中图片
- **WHEN** 用户选中图片后点击"导出"按钮
- **THEN** 弹出导出配置弹窗，支持批量下载选中图片

#### Scenario: 删除选中图片
- **WHEN** 用户选中图片后点击"删除"按钮
- **THEN** 弹出确认弹窗，确认后删除选中的历史图片

### Requirement: 批量作图多图上传
批量作图模式 SHALL 支持同时上传多张图片。

#### Scenario: 上传多张图片
- **WHEN** 用户在上传标签页选择或拖拽多张图片
- **THEN** 所有图片被上传并显示在列表中

### Requirement: 设置页面清空按钮
设置页面的图片模型和文本模型配置区 SHALL 提供清空按钮。

#### Scenario: 清空API配置
- **WHEN** 用户点击清空按钮
- **THEN** 对应配置的API Key、Base URL、模型名称被清空

### Requirement: 设置页面体验优化
设置页面 SHALL 提供更好的视觉层次和用户引导。

#### Scenario: 配置状态展示
- **WHEN** 用户进入设置页面
- **THEN** 清晰显示各配置项的状态和说明

## MODIFIED Requirements
无

## REMOVED Requirements
无
