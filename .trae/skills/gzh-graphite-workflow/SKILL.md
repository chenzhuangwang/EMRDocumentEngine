---
name: gzh-graphite-workflow
description: Rapid WeChat public account article layout with Graphite Minimal theme. Use when user asks to format a markdown article for WeChat public account with graphite-minimal style. Builds on the gzh-design skill with pre-memorized components, auto punctuation fixer, and Windows PowerShell workarounds.
---

# 公众号排版 · 石墨极简风快速工作流

本 skill 是 **gzh-design** skill 的**项目级加速层**。适用于本项目（EMR 文档编辑器系列）公众号文章的石墨极简风排版。

核心目标：把排版从 30+ tool call 压到 12 个以内。

---

## 1. 什么时候用

- 用户明确说「公众号排版」「gzh-design」「石墨极简风」
- Markdown 文件在 `knowledge/每日推文/公众号/` 目录下
- 输出文件名：`{原名}_排版_石墨极简风(graphite-minimal).html` + `_预览.html`

---

## 2. 石墨极简风核心组件速查（不再重查 theme-graphite-minimal.md）

**设计变量**（全部记住，不用读组件库）：
- 主色 `#52525B`（石墨灰）、标题色 `#27272A`（深炭）、辅助灰 `#A1A1AA`
- 极细线 `#E4E4E7`、极浅灰底 `#FAFAFA`、标签底 `#F4F4F5`
- 橙色 `#F97316`（全篇 ≤3 处，谨慎使用）
- 正文字号 15px、行高 1.8、字距 0.3px
- 章节间距 56px、max-width 677px

**组件 HTML 模板**（高频使用，直接写）：

章节标题（01/02…，首章 `margin-top:16px`，后续 `margin-top:56px`，末章用 `∞` + THE END）：
```html
<section style="margin-top:56px;margin-bottom:32px;padding:0 10px;">
  <section style="position:relative;padding-bottom:20px;border-bottom:1px solid #E4E4E7;">
    <p style="font-size:48px;font-weight:900;color:#E4E4E7;margin:0;line-height:1;letter-spacing:-2px;">
      <span leaf="">07</span>
    </p>
    <section style="margin-top:-8px;">
      <p style="font-size:10px;color:#A1A1AA;font-weight:500;letter-spacing:3px;margin:0 0 6px;text-transform:uppercase;">
        <span leaf="">YOUR TAG</span>
      </p>
      <h3 style="font-size:20px;font-weight:800;color:#27272A;margin:0;letter-spacing:0.5px;line-height:1.4;">
        <span leaf="">章节标题</span>
      </h3>
    </section>
  </section>
</section>
```

正文段（每段 1–3 处石墨下划线标记）：
```html
<p style="margin-bottom:22px;font-size:15px;line-height:1.8;text-align:justify;color:#52525B;letter-spacing:0.3px;">
  <span leaf="">前半句</span>
  <span style="border-bottom:2px solid #52525B;font-weight:600;color:#27272A;"><span leaf="">关键短语</span></span>
  <span leaf="">后半句</span>
</p>
```

石墨竖条金句（引言卡、核心观点）：
```html
<section style="border-left:3px solid #52525B;padding:16px 0 16px 24px;margin:0 0 28px;">
  <p style="font-size:16px;font-weight:700;color:#27272A;margin:0;line-height:1.7;letter-spacing:0.5px;">
    <span leaf="">「核心观点或金句」</span>
  </p>
</section>
```

圆形编号列表：
```html
<section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
  <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#27272A;color:#fff;font-size:12px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;"><span leaf="">1</span></span>
  <p style="font-size:15px;color:#52525B;margin:0;line-height:1.8;flex:1;"><span leaf="">列表项内容</span></p>
</section>
```

章节分割线（组件 4）：
```html
<section style="padding:0 10px;">
  <section style="height:1px;background:#E4E4E7;margin:0;"><span leaf=""><br></span></section>
</section>
```

引言卡（组件 2）、导读三看点（组件 3）、全局容器、END 线、签名区——模板和 gzh-design skill 中的 theme-graphite-minimal.md 完全一致，不用重查。

代码块用通用库 1a 深色版（顶栏三色圆点 + 语言名），每行一个 `<p style="margin:0">`，缩进用全角空格，**绝不写 `white-space:pre`**。

---

## 3. 自动化脚本（scripts/）

### `fix_punct.py` — 半角引号/标点一键修复

把 `<span leaf="">` 里的英文直引号 `"` → 中文弯引号 `""`、英文单引号 `'` → `''`、中文后的半角标点（, . ! ? : ;）→ 全角。

**关键细节**：必须用 **re.DOTALL 贪婪匹配** `.*?` 或贪婪 `.*`，因为 `<span leaf="">` 里可能嵌套 `<strong>` 等标签。普通 `[^<]*` 匹配不到嵌套场景，会漏修。

```bash
python scripts/fix_punct.py <html_file>
```

### `validate.sh` / PowerShell 调用 workaround

PowerShell 遇到路径中的括号 `()` 会解析失败。解法：
1. 先 `Copy-Item` 到无括号临时路径（如 `validate-temp.html`）
2. 对临时路径跑校验
3. 校验完删除临时文件

```powershell
Copy-Item '<原文名>.html' 'validate-temp.html'
& python 'c:\Users\Administrator\.trae-cn\skills\gzh-design\scripts\validate_gzh_html.py' 'validate-temp.html'
Remove-Item 'validate-temp.html'
```

---

## 4. 装配流水线（5 步搞定一篇）

```
Step 1: Read Markdown → 识别章节结构（## 编号 + 附件 A/B/C/D 排除）
Step 2: Write 完整 HTML（组件模板直接敲，章节编号 01→02…→∞）
Step 3: python scripts/fix_punct.py <html_file>  # 引号/半角标点全修
Step 4: validate_gzh_html.py → 确认 0 ERROR / 0 WARNING
Step 5: wrap_preview.py → 生成 _预览.html
```

**不要做的事**：
- 不要每次重读 theme-graphite-minimal.md（组件模板已在 section 2 速查）
- 不要用 `[^<]*` 做正则（漏嵌套 span leaf）
- 不要把附件 A/B/C/D（事实自检表、配图清单、发布清单、待甲方确认）放进正文
- 不要超过 3 处橙色使用配额

---

## 5. Markdown 解析约定（本项目公众号文章）

### 排除区域

本项目公众号 Markdown 通常末尾有：
```
---
# 以下为发布附件（不随稿件发布到平台）
## 附件 A · 事实自检表
## 附件 B · 配图清单
## 附件 C · 发布清单
## 附件 D · 待甲方确认
```

**排版时从 `# 以下为发布附件` 开始全部跳过**，只排正文到「写在最后」+ END + 签名。

### 章节编号

- 第一个 `##` → 01
- 第二个 `##` → 02
- ……
- 最后一个 `##` → 如果是"写在最后"或类似结语，用 `∞` 替代数字，英文标签用 `THE END`
- 中间章节数字依次递增

### 英文标签映射

| 中文章节标题 | 英文标签 |
|---|---|
| 问题的形状 / 先给结论 / 解法 | PROBLEM SHAPE / THE COST / THE CONTRACT |
| 路线一 / 路线二 / 路线三 | ROUTE 1 · PRODUCT / ROUTE 2 · OPEN SOURCE / ROUTE 3 · BUILD |
| 选型最容易踩的坑 | FIVE PITFALLS |
| 坦诚地说 / 现状 | HONEST STATUS |
| 写在最后 | THE END |

### 代码块处理

通用库 1a 深色版（顶栏三色圆点 + 语言名），**每行一个 `<p style="margin:0">`**，缩进用全角空格 `　`，禁止 `white-space:pre`。

### 表格

石墨极简风组件 12 表格：深炭表头 + 偶数行极浅灰底 + 路线标签用组件 7b 极浅灰底徽章。

---

## 6. 校验脚本 WARNING 解读

`validate_gzh_html.py` 的 WARNING 一般只有两类：

1. **半角标点/英文引号**：用 `scripts/fix_punct.py` 一键修
2. **span leaf 内嵌套 strong/标签导致匹配遗漏**：手动 Edit 具体那行

ERROR 是红线，必须清零才能交付。

---

## 7. 项目公众号系列位置知识

本项目公众号系列：
- 账号：旺de碎碎念
- 系列前缀：「EMR 文档编辑器」系列第 N 篇
- UTM campaign 命名：`W0{序号}-{slug}`，如 `W09-selection-map`
- 文章目录：`knowledge/每日推文/公众号/`
- 往期精选：从同目录 `已发/` 子目录取前 3 篇标题

写在最后时要：
- 说明"这是系列第 N 篇，上一篇聊了 X，这一篇聊了 Y"
- 预告下一篇（承接文末预告）
- 挂往期精选 3 条
- 挂"一份病历不该是医生的负担"公益句

---

## 8. 输出命名

| 产物 | 命名 |
|---|---|
| 干净正文 HTML | `{原名}_排版_石墨极简风(graphite-minimal).html` |
| 带复制按钮的预览 | `{原名}_排版_石墨极简风(graphite-minimal)_预览.html` |

交付时：
1. 说清楚两个文件路径
2. 校验结论（0 ERROR / 0 WARNING）
3. 打开预览 → 复制按钮 → 公众号编辑器粘贴

---

## 依赖

- **全局 gzh-design skill**（提供 validate_gzh_html.py / wrap_preview.py 脚本和完整组件库定义，本 skill 是它的石墨极简风项目特化层）
- **scripts/fix_punct.py**（本 skill 附带）
