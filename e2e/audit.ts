import type { Page } from '@playwright/test';

// アクセシビリティの自動監査（e2e/home-a11y.spec.ts と同じ判定。体重画面などで再利用）
// 横スクロール・文字のはみ出し/切れ/重なり・44×44px 未満のタップ領域・コントラスト比を調べる
/** ページ内で、はみ出し・重なり・小さいタップ領域・低コントラストを調べる */
export async function audit(page: Page, width = 375) {
  return page.evaluate((vw) => {
    const problems: string[] = [];
    // モバイル表示では内容が広いと画面が縮小され innerWidth も広がるため、想定幅（375px）と比べる
    if (document.documentElement.scrollWidth > vw) problems.push(`横スクロール ${document.documentElement.scrollWidth}px > ${vw}px`);

    const inOverlay = (el: Element) => !!el.closest('.nav, .toasts');
    const visible = (el: Element) => {
      // 閉じた <details> の中身（summary 以外）は画面に描かれていない
      const det = el.closest('details');
      if (det && !det.open && !el.closest('summary')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const main = document.querySelector('main')!;

    // 1) タップ領域 44×44 以上
    for (const el of main.querySelectorAll('a[href], button, [role="checkbox"], input, select, textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) problems.push(`タップ領域が小さい: "${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }

    // 文字を直接持つ要素
    const textEls: Element[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (!t.data.trim()) continue;
      const el = t.parentElement!;
      if (!textEls.includes(el) && visible(el) && !inOverlay(el)) textEls.push(el);
    }

    // 2) 文字の切れ（はみ出し）
    for (const el of textEls) {
      // 要素の箱ではなく、文字そのものの位置で判定する
      const range = document.createRange();
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !(n as Text).data.trim()) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.right > vw + 0.5 || r.left < -0.5) problems.push(`画面外にはみ出し: "${el.textContent!.trim().slice(0, 20)}"`);
        }
      }
      let p: Element | null = el;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX === 'hidden' || cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && p.scrollWidth > p.clientWidth + 1 && !p.classList.contains('progress')) {
          problems.push(`文字の切れ: "${el.textContent!.trim().slice(0, 20)}"`);
          break;
        }
        p = p.parentElement;
      }
    }

    // 3) 文字同士の重なり（行ボックス単位）
    const rectsOf = (el: Element) => {
      const range = document.createRange();
      const out: DOMRect[] = [];
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && (n as Text).data.trim()) {
          range.selectNodeContents(n);
          out.push(...Array.from(range.getClientRects()));
        }
      }
      return out;
    };
    const boxes = textEls.map((el) => ({ el, rects: rectsOf(el) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
        for (const a of boxes[i].rects) for (const b of boxes[j].rects) {
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 4) problems.push(`文字の重なり: "${boxes[i].el.textContent!.trim().slice(0, 12)}" と "${boxes[j].el.textContent!.trim().slice(0, 12)}"`);
        }
      }
    }

    // 4) コントラスト比
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
      return [Number(r), Number(g), Number(b), Number(a)];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element): number[] => {
      const layers: number[][] = [];
      let p: Element | null = el;
      while (p) {
        const c = parse(getComputedStyle(p).backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
        p = p.parentElement;
      }
      let base = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop()! : parse(getComputedStyle(document.body).backgroundColor)!;
      while (layers.length) {
        const top = layers.pop()!;
        base = [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
      }
      return base;
    };
    for (const el of textEls) {
      if (el.closest('[disabled], [aria-hidden="true"]')) continue;
      const text = el.textContent!.trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue; // 絵文字・記号のみは対象外
      const cs = getComputedStyle(el);
      const fg = parse(cs.color)!;
      const bg = bgOf(el);
      const fgc = fg[3] < 1 ? [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) : fg;
      const L1 = lum(fgc), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio < need) problems.push(`コントラスト不足 ${ratio.toFixed(2)} < ${need}: "${text.slice(0, 20)}"`);
    }
    return problems;
  }, width);
}

