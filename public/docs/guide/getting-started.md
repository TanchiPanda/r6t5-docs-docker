# 快速开始

本文介绍如何在本地预览文档站，以及如何把修改发布到线上。

## 本地预览

站点为纯静态页面，无需构建工具。任选一种方式：

### 方式一：直接打开

双击根目录的 `index.html`，用浏览器打开即可。

> 注意：`?path=` 加载文档与目录清单依赖 `fetch`，部分浏览器在 `file://` 协议下会拦截本地请求。若目录为空，请使用方式二启动本地服务。

### 方式二：启动本地静态服务

在仓库根目录执行：

```bash
# Python 3
python3 -m http.server 8000

# 或 Node.js
npx serve .
```

然后访问 <http://localhost:8000>。

## 发布到 GitHub Pages

1. 仓库页面进入 **Settings → Pages**。
2. **Source** 选择 `Deploy from a branch`。
3. **Branch** 选择 `main`，文件夹选择 `/(root)`，点击 **Save**。
4. 等待 1～3 分钟，访问：

```text
https://<用户名>.github.io/<仓库名>/
```

## 日常编辑流程

1. 在本地修改或新增 Markdown 文档。
2. 在 `manifest.json` 中登记目录条目。
3. 提交推送：

```bash
git add .
git commit -m "docs: 新增 xxx 文档"
git push origin main
```

4. 推送完成后，Pages 自动重新部署，刷新线上页面即可看到更新。
