# 配置说明

本文说明站点中可调整的配置项，均位于 `index.html` 顶部的 `<script>` 区域。

## 仓库信息

```js
const REPO = '用户名/仓库名';
const DEFAULT_PATH = 'docs/index.md';
const ATTRIBUTION = { /* 署名规范字符串，请勿修改 */ };
const FOOTER = {
  showProNote: false   // 已授权版本
};
```

| 配置 | 说明 |
| ---- | ---- |
| `REPO` | GitHub 仓库地址，格式为 `用户名/仓库名`，用于拼接「在 GitHub 上编辑」链接 |
| `DEFAULT_PATH` | 未携带 `?path=` 参数时默认加载的文档路径 |
| `ATTRIBUTION` | 署名规范字符串与模板仓库链接，社区版不得修改 |
| `FOOTER.showProNote` | 是否显示「使用专业版、订制版可去除本标志」提示；本授权版为 `false`，若误改为 `true` 会重新显示该提示 |

## 署名与校验

授权版基础署名（逐字符一致，含标点，无多余空格）：

```text
本站由r6t5-docs提供支持，使用专业版、订制版可去除本标志
```

署名链接必须为 `https://github.com/TanchiPanda/r6t5-docs-community`。仓库内置三重校验：

| 机制 | 作用 |
| ---- | ---- |
| `scripts/check_attribution.py` | 本地/CI 逐字符比对署名与链接，差异会定位到第几个字符 |
| `.github/workflows/attribution-guard.yml` | 每次 push / PR 自动校验；每周巡检线上站点 |
| `index.html` 运行时守卫 | 页面加载时比对 DOM，被删改则显示提示并自动恢复标准署名 |

本地校验：

```bash
python3 scripts/check_attribution.py --licensed            # 本授权版
python3 scripts/check_attribution.py --url <线上地址> --licensed
```

发现他人副本不合规时，可扫描公开仓库：

```bash
GITHUB_TOKEN=xxx python3 scripts/scan_public_copies.py
```

详细条款见仓库根目录 `LICENSE`。

## 目录清单格式

`manifest.json` 支持嵌套层级，节点类型有两种：

**分组节点**（可折叠）：

```json
{
  "title": "分组名称",
  "children": [ /* 子节点 */ ]
}
```

**文档节点**：

```json
{ "title": "文档标题", "path": "docs/reference/config.md" }
```

分组可以多层嵌套，侧边栏会递归生成可折叠目录。

## Markdown 渲染

页面使用 [marked](https://marked.js.org/) 在浏览器端将 Markdown 转为 HTML，已开启 GFM 表格与换行支持。如需代码高亮、数学公式等扩展能力，可在 `index.html` 中引入对应插件并在 `marked.setOptions` 中配置。

## 自定义样式

所有样式集中在 `index.html` 的 `<style>` 区域，CSS 变量定义在 `:root` 下，可直接修改主题色、边框、背景等：

```css
:root {
  --accent: #0969da;
  --sidebar-bg: #f7f8fa;
  --border: #e5e7eb;
}
```
