# r6t5 文档

欢迎使用 **r6t5** 项目文档站。本站基于 GitHub Pages 托管，所有文档以 Markdown 编写，在浏览器中实时渲染为 HTML。

## 页面说明

- **左侧**：可折叠的文档目录，点击条目即可切换文档。
- **右侧顶部**：「在 GitHub 上编辑」按钮，点击后直接跳转到当前文档在 GitHub 上的编辑页面。
- **文档定位**：通过 URL 参数 `?path=` 指定要加载的文档，例如：

```text
https://<用户名>.github.io/<仓库名>/?path=docs/guide/getting-started.md
```

不传 `path` 参数时，默认加载 `docs/index.md`。

## 如何新增文档

1. 在 `docs/` 目录下新建 Markdown 文件，例如 `docs/guide/faq.md`。
2. 打开 `manifest.json`，在对应分组的 `children` 中添加一条记录：

```json
{ "title": "常见问题", "path": "docs/guide/faq.md" }
```

3. 提交并推送到 `main` 分支，GitHub Pages 会自动重新部署。
