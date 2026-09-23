#!/usr/bin/env python3
"""公众号 HTML 合规修复：半角引号/标点 → 中文全角。

修复策略（双 pass，覆盖 span leaf 内嵌套 strong 等标签的场景）：

  Pass 1: 用 re.DOTALL 贪婪匹配 <span leaf=""> 到 </span>
          不管中间有没有嵌套 <strong>，把整段的英文直引号
          成对替换为中文弯引号（"" / ''）。

  Pass 2: 再跑一次同一模式，把中文字后的半角 , . ! ? : ;
          替换为全角。

用法:
  python fix_punct.py <html_file>
"""

import re
import sys


def fix_quotes_in_leaf(leaf_content: str) -> str:
    """把一个 <span leaf="">...</span> 内部的英文直引号成对改为中文弯引号。"""
    # 用 split 把原文按 " 切分，再按奇数/偶数位置交替补 " 和 "
    # 这样天然处理了中文双引号内嵌套英文短引号的情况
    parts = re.split(r'(")', leaf_content)
    result = []
    quote_depth = 0
    for p in parts:
        if p == '"':
            quote_depth += 1
            result.append('\u201c' if quote_depth % 2 == 1 else '\u201d')
        else:
            # 顺带处理英文单引号（成对）
            single_parts = re.split(r"(')", p)
            s_depth = 0
            for sp in single_parts:
                if sp == "'":
                    s_depth += 1
                    result.append('\u2018' if s_depth % 2 == 1 else '\u2019')
                else:
                    result.append(sp)
    return ''.join(result)


def fix_punct_in_leaf(leaf_content: str) -> str:
    """把中文字符后的半角标点改为全角。"""
    cjk = r'[\u4e00-\u9fff㐀-䶿]'
    # 中文后 半角冒号/分号/逗号/句号/问号/感叹号
    leaf_content = re.sub(rf'({cjk})\s*:\s*', r'\1：', leaf_content)
    leaf_content = re.sub(rf'({cjk})\s*;\s*', r'\1；', leaf_content)
    leaf_content = re.sub(rf'({cjk})\s*,\s*', r'\1，', leaf_content)
    leaf_content = re.sub(rf'({cjk})\s*\.\s*', r'\1。', leaf_content)
    leaf_content = re.sub(rf'({cjk})\s*\?\s*', r'\1？', leaf_content)
    leaf_content = re.sub(rf'({cjk})\s*!\s*', r'\1！', leaf_content)
    # 半角括号内中文语境——不主动改括号本身（可能是代码/URL），
    # 只改 ）后紧跟的半角冒号（"XXX）:"  → "XXX）："）
    leaf_content = re.sub(r'）\s*:', '）：', leaf_content)
    return leaf_content


def process(html: str) -> str:
    # Pass 1: 引号
    def quote_sub(m):
        inner = m.group(1)
        fixed = fix_quotes_in_leaf(inner)
        return '<span leaf="">' + fixed + '</span>'

    html = re.sub(r'<span leaf="">(.*?)</span>', quote_sub, html, flags=re.DOTALL)

    # Pass 2: 半角标点
    def punct_sub(m):
        inner = m.group(1)
        fixed = fix_punct_in_leaf(inner)
        return '<span leaf="">' + fixed + '</span>'

    html = re.sub(r'<span leaf="">(.*?)</span>', punct_sub, html, flags=re.DOTALL)

    return html


def main():
    if len(sys.argv) < 2:
        print('Usage: python fix_punct.py <html_file>', file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    fixed = process(content)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(fixed)

    print(f'✅ 已修复引号和半角标点: {path}')


if __name__ == '__main__':
    main()
