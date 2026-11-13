# r6t5-docs Docker 版

一套镜像、两种形态，代码同频：

| 状态 | 行为 |
|---|---|
| **社区版**（未输入产品密钥） | 页脚署名逐字符锁定为标准文案，显示「，使用专业版、订制版可去除本标志」，后台无法修改署名 |
| **专业版**（管理员输入有效 15 位密钥） | 隐藏推广提示，署名文字/链接可自由修改（白标） |

自带管理后台：`/admin`，可图形化管理文档树、编辑全部 Markdown 文字与超链接、复制预览链接、输入产品密钥。

## 快速开始

```bash
docker compose up -d --build
docker compose logs -f          # 首次启动会打印管理员密码
```

浏览器打开：

- 站点：`http://<host>:8080/`
- 后台：`http://<host>:8080/admin`（密码见日志，同时存于 `./data/ADMIN_PASSWORD.txt`）

不想用 compose：

```bash
docker build -t r6t5-docs:1.1 .
docker run -d --name r6t5-docs -p 8080:8080 \
  -v $(pwd)/data:/data \
  -e LICENSE_API=https://lic.r6t5.dpdns.org \
  r6t5-docs:1.1
docker logs r6t5-docs | head -20
```

## 管理后台能做什么

1. **授权状态**：粘贴 15 位产品密钥 → 调 `/api/license/redeem-host` 绑定当前域名 → 立即切换专业版（无需重启）。
2. **站点设置**：站点标题、GitHub 仓库、默认文档、页脚署名（专业版才可改署名）。
3. **文档树**：分组增删改、文档上下移动、改标题、预览、直接跳转编辑；保存后自动重写 `manifest.json`。
4. **编辑文档**：任意 `docs/**.md` 全文字与超链接的原文编辑，保存即生效（站点无缓存）。
5. **预览链接**：每个文档生成 `/?path=<文件>` 链接，可直接复制发人。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `DATA_DIR` | `/data` | 数据卷（站点文件、树结构、授权、管理员） |
| `LICENSE_API` | `https://lic.r6t5.dpdns.org` | 授权服务地址 |
| `SITE_HOST` | 取请求 Host | 密钥绑定的域名，反代后建议显式设置 |
| `ADMIN_PASSWORD` | 自动生成 | 固定管理员密码 |
| `PRO` | `0` | `1` = 强制专业版（隔离内网、无网校验时用；等于跳过密钥校验，仅限已获授权场景） |

## 数据卷结构

```
data/
├── site/                # 站点文件（首次启动从镜像复制，之后可改）
│   ├── index.html
│   ├── docs/**.md
│   └── manifest.json    # 自动生成，别手改
├── site.json            # 标题/仓库/署名
├── tree.json            # 文档树结构
├── license.json         # 授权状态（含明文密钥，注意权限）
├── admin.json           # 管理员密码哈希
└── ADMIN_PASSWORD.txt   # 首次生成的明文密码（可删）
```

备份只需拷走整个 `data/`。删除 `data/admin.json` 并重启 = 重置管理员密码。

## 换成专业版

1. 后台登录 → 「授权状态」输入 `XXXXX-XXXXX-XXXXX`。
2. 密钥会与当前域名绑定（`SITE_HOST` 或请求 Host），绑定后不可更换。
3. 激活成功即切换：推广提示消失、署名可编辑。

> 已有的专业版站点也可以直接搬进来：把旧站的 `index.html`、`docs/` 覆盖到 `data/site/` 即可。

## 安全说明

- 后台只允许密码登录，会话 Cookie 为 `HttpOnly; SameSite=Strict`，写接口校验 `X-R6T5-Admin` 头（挡 CSRF）。
- 所有文件操作限定在 `data/site/docs/`，拒绝 `..` 穿越。
- 建议放在 HTTPS 反向代理后面（Nginx/Caddy），并只对可信网络开放 `/admin`。
- 社区版署名由**服务端**注入标准文案，即使有人改了磁盘上的 `site.json` 也不会生效。
