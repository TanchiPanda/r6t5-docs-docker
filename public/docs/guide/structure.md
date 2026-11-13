# 目录结构

仓库的文件组织方式如下：

```text
<仓库名>/
├── index.html          # 站点渲染器：侧边栏目录 + 文档内容 + GitHub 编辑按钮
├── manifest.json       # 文档目录清单（左侧树由此文件生成）
├── README.md           # 仓库说明
└── docs/               # 所有 Markdown 文档
    ├── index.md        # 默认首页文档
    ├── guide/          # 指南类文档
    │   ├── getting-started.md
    │   └── structure.md
    └── reference/      # 参考类文档
        └── config.md
```

## 关键文件说明

| 文件 | 作用 |
| ---- | ---- |
| `index.html` | 页面骨架与交互逻辑：读取 `manifest.json` 生成目录，按 `?path=` 拉取 Markdown 并用 marked 渲染为 HTML |
| `manifest.json` | 目录树配置。每个节点可包含 `title`、`path`，或嵌套 `children` 形成可折叠分组 |
| `docs/` | 文档源文件目录，全部使用 Markdown 编写 |

## 路径规则

- 页面中的所有资源路径均为**相对路径**，保证仓库部署在项目站点子路径（`/<仓库名>/`）下也能正常访问。
- `?path=` 的值相对于仓库根目录填写，例如 `docs/guide/structure.md`。
- 「在 GitHub 上编辑」按钮会拼接为：

```text
https://github.com/<用户名>/<仓库名>/edit/main/<文档路径>
```
