/* ============================================================
   lab-engine.js — 互動講解ページ 共通 LAB エンジン（v3）
   ------------------------------------------------------------
   対象  : sample/講解ページ/*.html ・ sample/参考実装/*.html
   参照  : <script src="../assets/lab-engine.js"></script>（</body> 直前）
   設計  : LAB の状態から**完成した1枚のミニ HTML 文書**を生成し、
           <iframe srcdoc> とコードエディタへ同時に流す。
           「表示中のコード＝実行中の文書」を機構で保証する（人手同期なし）。
   規約  : クラシックスクリプト（type="module" にしない）。
           file:// で直接開いても動く必要があるため。
           stage 固有のロジック（vol.8 二軸ノートなど）は本ファイルに入れず、
           そのページの <script> にインラインで書く。
   来歴  : 2026-07-30 参考実装 _ref_LABエンジン実装.html の <script> から抽出。
           抽出結果は vol.13 講解ページの <script> と逐字一致（機械確認済み）。
   ============================================================ */
(function () {
  'use strict';

  /* ================= シンタックスハイライト ================= */
  function esc(s) {
    return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }
  function wrap(cls, s) { return '<span class="t-' + cls + '">' + esc(s) + '</span>'; }
  function wrapTrim(cls, s) {
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return esc(m[1]) + (m[2] ? wrap(cls, m[2]) : '') + esc(m[3]);
  }
  function hlValue(s) {
    return s.split(/(\s+)/).map(function (p) {
      if (!p.trim()) return esc(p);
      if (p === '!important') return wrap('at', p);
      if (/^url\(/i.test(p) || /^"/.test(p)) return wrap('str', p);
      if (/^(#[0-9a-fA-F]{3,8}|-?\d*\.?\d+[a-z%]*)$/.test(p)) return wrap('num', p);
      return wrap('val', p);
    }).join('');
  }
  function hlTag(t) {
    if (/^<!/.test(t)) return wrap('at', t);
    var m = t.match(/^<\/?([a-zA-Z][\w-]*)/);
    if (!m) return esc(t);
    var out = wrap('punc', t.slice(0, m[0].length - m[1].length)) + wrap('tag', m[1]);
    var rest = t.slice(m[0].length), p = 0, mm;
    var re = /([a-zA-Z-]+)(=)?("[^"]*"|'[^']*')?|(\/?>)/g;
    while ((mm = re.exec(rest))) {
      if (mm[0] === '') { re.lastIndex++; continue; }
      out += esc(rest.slice(p, mm.index));
      if (mm[4]) out += wrap('punc', mm[4]);
      else {
        if (mm[1]) out += wrap('attr', mm[1]);
        if (mm[2]) out += wrap('punc', mm[2]);
        if (mm[3]) out += wrap('str', mm[3]);
      }
      p = mm.index + mm[0].length;
    }
    return out + esc(rest.slice(p));
  }
  function hlHtmlLine(s) {
    var out = '', i = 0;
    while (i < s.length) {
      if (s[i] === '<') {
        var j = s.indexOf('>', i);
        if (j < 0) j = s.length - 1;
        out += hlTag(s.slice(i, j + 1)); i = j + 1;
      } else {
        var k = s.indexOf('<', i); if (k < 0) k = s.length;
        out += esc(s.slice(i, k)); i = k;
      }
    }
    return out;
  }
  function hlCssLine(s, depth) {
    var out = '', i = 0;
    while (i < s.length) {
      if (s.substr(i, 2) === '/*') {
        var e = s.indexOf('*/', i); e = e < 0 ? s.length : e + 2;
        out += wrap('com', s.slice(i, e)); i = e; continue;
      }
      var c = s[i];
      if ('{};:,'.indexOf(c) >= 0) {
        out += wrap('punc', c);
        if (c === '{') depth++; else if (c === '}') depth = Math.max(0, depth - 1);
        i++; continue;
      }
      var j = i;
      while (j < s.length && '{};:,'.indexOf(s[j]) < 0 && s.substr(j, 2) !== '/*') j++;
      var chunk = s.slice(i, j), next = s[j] || '';
      if (depth === 0) out += wrapTrim('sel', chunk);
      else if (next === ':') out += wrapTrim('prop', chunk);
      else out += hlValue(chunk);
      i = j;
    }
    return { html: out, depth: depth };
  }
  function highlight(src) {
    var lines = src.split('\n'), inStyle = false, depth = 0, out = [];
    // zone は3状態の状態機で決める（2026-08-01 修正）。
    // 旧実装は </style> の**次の行**から body 区に切り替えていたため、ちょうどその位置にある
    // </head> が body 区に混ざり、HTML タブに「開きタグの無い </head>」だけが浮いて見えていた
    // （head 区の折りたたみ範囲は 1〜4 行目なので、この行だけ畳まれずに残る）。
    // <body> 行に到達するまでは head 区に戻す、が正しい。
    // なお <body> 以降の <style> は data-slot が body 内へ持ち込んだ演示対象そのもの
    // （例：vol.8 の style 要素）なので CSS 区に吸わせず、body 区のまま HTML タブ側に残す。
    var state = 'head'; // 'head' | 'style' | 'body'
    lines.forEach(function (line) {
      var html, zone;
      if (inStyle && !/<\/style>/.test(line)) {
        var r = hlCssLine(line, depth); html = r.html; depth = r.depth;
        zone = 'style';
      } else {
        html = hlHtmlLine(line);
        if (state !== 'body' && /<style[^>]*>/.test(line)) { inStyle = true; depth = 0; state = 'style'; zone = 'style'; }
        // </style> 行自体は style 区の一部として出す（CSS タブで閉じタグが消えるのを防ぐ）
        else if (state === 'style' && /<\/style>/.test(line)) { inStyle = false; state = 'head'; zone = 'style'; }
        else if (/<body[^>]*>/.test(line)) { state = 'body'; zone = 'body'; }
        else zone = (state === 'body') ? 'body' : 'head';
      }
      // data-ln＝行番号。折りたたまれた行は display:none になるので、番号は自然に飛ぶ
      //（IDE で「ここが畳まれている」と分かる一番の手がかりが、この番号の飛びである）
      out.push('<span class="cl" data-zone="' + zone + '" data-ln="' + (out.length + 1) + '">' + (html === '' ? '&#8203;' : html) + '</span>');
    });
    return out.join('');
  }

  // doc 内 <style> 区の規則ブロックを列挙： [{start, end, selector}] （行インデックス、endを含む）
  function findCssBlocks(doc) {
    var lines = doc.split('\n'), blocks = [], depth = 0, curStart = -1, curSel = '';
    var inStyle = false;
    lines.forEach(function (line, i) {
      if (/<style[^>]*>/.test(line)) { inStyle = true; return; }
      if (/<\/style>/.test(line)) { inStyle = false; return; }
      if (!inStyle) return;
      if (depth === 0 && /\{\s*$/.test(line)) { curStart = i; curSel = line.split('{')[0].trim(); }
      if (line.indexOf('{') >= 0) depth++;
      if (line.indexOf('}') >= 0) {
        depth--;
        if (depth === 0 && curStart >= 0) { blocks.push({ start: curStart, end: i, selector: curSel }); curStart = -1; }
      }
    });
    return blocks;
  }

  // doc 内 <body> 区のトップレベル要素を列挙： [{start, end}] （行インデックス、endを含む）
  // CSS の findCssBlocks と対の役割。生成 HTML は基本 1 行 1 タグ（dedent 済み）を前提にした簡易パーサ。
  var VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  function findHtmlBodyBlocks(doc) {
    var lines = doc.split('\n'), blocks = [], depth = 0, curStart = -1, inBody = false;
    var tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
    lines.forEach(function (line, i) {
      if (/<body[^>]*>/.test(line)) { inBody = true; return; }
      if (/<\/body>/.test(line)) { inBody = false; return; }
      if (!inBody) return;
      var opens = 0, closes = 0, m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line))) {
        var closing = m[1] === '/', tag = m[2].toLowerCase(), selfClose = m[4] === '/' || VOID_TAGS[tag];
        if (closing) closes++; else if (!selfClose) opens++;
      }
      if (depth === 0 && curStart < 0 && opens > 0) curStart = i;
      depth += opens - closes;
      if (curStart >= 0 && depth <= 0) { blocks.push({ start: curStart, end: i }); curStart = -1; depth = 0; }
    });
    return blocks;
  }

  /* ================= 補助 ================= */
  var ORDER = ['box-sizing', 'display', 'flex-direction', 'grid-template-columns', 'position',
               'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear'];
  function sortDecls(list) {
    return list.map(function (d, i) { return { d: d, i: i, k: ORDER.indexOf(d.split(':')[0].trim()) }; })
      .sort(function (a, b) {
        var ka = a.k < 0 ? 99 : a.k, kb = b.k < 0 ? 99 : b.k;
        return ka - kb || a.i - b.i;
      }).map(function (o) { return o.d; });
  }
  function dedent(s) {
    s = s.replace(/^\n+/, '').replace(/\s+$/, '');
    var lines = s.split('\n'), min = null;
    lines.forEach(function (l) {
      if (!l.trim()) return;
      var n = l.match(/^ */)[0].length;
      if (min === null || n < min) min = n;
    });
    return lines.map(function (l) { return l.slice(min || 0); }).join('\n');
  }
  function splitDecls(str) {
    return (str || '').split(';').map(function (d) { return d.trim(); }).filter(Boolean);
  }
  function injectSlot(html, frag) {
    return html.replace(/^([ \t]*)\{\{SLOT\}\}[ \t]*$/m, function (_, ind) {
      return frag.split('\n').map(function (l) { return l ? ind + l : l; }).join('\n');
    });
  }

  /* ================= LAB ================= */
  document.querySelectorAll('.lab').forEach(function (lab) {
    var baseCss = dedent(lab.querySelector('.lab-css').textContent);
    var baseHtml = dedent(lab.querySelector('.lab-html').textContent);
    var selector = lab.dataset.selector || '';
    var minH = parseInt(lab.dataset.minh || '160', 10);
    var state = {};        // プロパティ → 値
    var ruleOverride = ''; // data-rule 使用時の CSS 全文（単一グループの LAB 用）
    var ruleSlots = {};    // 二軸 LAB 用: { main: {text, order}, extra: {text, order} }
    var slot = '';         // data-slot 使用時の HTML 断片
    var focusZone = lab.dataset.focus === 'html' ? 'html' : 'css'; // この stage が教えている側。値ボタンの変化はここにしか起きない
    var activeZone = focusZone; // 既定は focusZone を表示（HTML/CSS は層1、値ボタンは層2 で focusZone の中だけを動かす）
    var lastDoc = '';
    var pendingFlash = false;
    var curFrameH = 0; // この LAB に現在適用中の iframe 高さ（ヒステリシスで小さな増減を吸収する）
    var SHRINK_THRESHOLD = 24; // 新しい実測値がこれ以上小さい時だけ縮める（px）

    // 【2026-07-31 改装】コード枠とプレビューを1枚のパネルに同居させる。
    // 外枠・タブ・操作欄は紙面（ページと同じ明度帯）、コード領域だけを暗色にする。
    // 以前は「黒いカード」と「白いカード」が2枚離れて浮いており、左のソースと右の結果が
    // 同じ1つの装置だと読めなかった。横帯もタブ / ファイル名 / 操作の3本あって重かった。
    var body = lab.querySelector('.lab-body');
    body.innerHTML =
      '<div class="ed-wrap">' +
        '<div class="ed-tabs">' +
          '<button class="ed-tab" data-zone="html">HTML</button>' +
          '<button class="ed-tab" data-zone="css">CSS</button>' +
        '</div>' +
        '<div class="ed-panes">' +
          '<div class="ed">' +
            '<button class="ibtn" data-act="copy" title="コードをコピー"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>' +
            '<pre class="ed-hl" tabindex="0" aria-label="デモのソースコード"></pre>' +
            '<textarea class="ed-ta" spellcheck="false" readonly aria-hidden="true" tabindex="-1"></textarea>' +
          '</div>' +
          '<div class="demo-col"><div class="frame-wrap"><iframe class="lab-frame" title="デモの表示"></iframe></div></div>' +
        '</div>' +
      '</div>';

    var edWrap = body.querySelector('.ed-wrap');
    var hl = body.querySelector('.ed-hl');
    var ta = body.querySelector('.ed-ta');

    // 折りたたみの開閉は hl に1本だけ委任リスナーを張る（LAB の生存期間中ずっと同じ1本のまま）。
    // foldRange() 側は行に data-fold-key を書くだけで、要素ごとに addEventListener しない
    // （個別に付けるとトグルのたびに増殖するバグがあったため。上の foldRange 内コメント参照）。
    function handleFoldToggle(e) {
      var head = e.target.closest ? e.target.closest('.cl.foldable') : null;
      if (!head) return;
      var key = head.dataset.foldKey;
      if (!key) return;
      foldState[key] = !foldState[key];
      applyFold(lastDoc);
    }
    hl.addEventListener('click', handleFoldToggle);
    hl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var head = e.target.closest ? e.target.closest('.cl.foldable') : null;
      if (!head) return;
      e.preventDefault();
      handleFoldToggle(e);
    });

    // 操作欄（層2）をパネルの中・タブの直下に入れる。
    var labCtl = lab.querySelector('.lab-ctl');
    if (labCtl) {
      edWrap.insertBefore(labCtl, edWrap.querySelector('.ed-panes'));
      // ラベルはプロパティ名のみ。「◯◯ の値を切り替える」のような説明文は付けない
      //（同じ言い回しが4行続くとノイズにしかならない。操作方法はページ冒頭で一度言う）。
      labCtl.querySelectorAll('.ctl-label').forEach(function (lbl) {
        var t = lbl.textContent.trim();
        // 「HTML」「CSS」＝直上のタブと完全重複するため隠す
        if (t === 'HTML' || t === 'CSS') lbl.style.display = 'none';
      });
    }
    // 説明文（.lab-note）は LAB の一番下ではなく、操作欄のすぐ下＝押したボタンの直下に置く。
    // 一番下だと「押した所」と「その説明」が離れ、視線が往復する。
    var noteEl = lab.querySelector('.lab-note');
    if (noteEl) edWrap.insertBefore(noteEl, edWrap.querySelector('.ed-panes'));
    var frameWrap = body.querySelector('.frame-wrap');
    var frame = body.querySelector('.lab-frame');

    // 説明文の高さぶんだけ min-height を実測して確保する（固定 em ではなく LAB ごとの実測値）
    // .vbtn の data-note 全部＋ data-good-note を候補として、実幅で1つずつ流し込み最大の offsetHeight を取る
    function measureNoteMinH() {
      var texts = [];
      lab.querySelectorAll('.vbtn, .vsel option').forEach(function (b) {
        if (b.dataset.note != null) texts.push(b.dataset.note);
      });
      if (lab.dataset.goodNote) texts.push(lab.dataset.goodNote);
      if (!texts.length) return;
      var orig = noteEl.textContent;
      noteEl.style.minHeight = '0';
      var maxH = 0;
      texts.forEach(function (t) {
        noteEl.textContent = t;
        maxH = Math.max(maxH, noteEl.offsetHeight);
      });
      noteEl.textContent = orig;
      noteEl.style.minHeight = maxH + 'px';
    }
    // .ed-ta の padding-top / line-height を実測してキャッシュ（CSS の値をハードコードしない）
    var taCs = getComputedStyle(ta);
    var taPadTop = parseFloat(taCs.paddingTop) || 12;
    var taLineH = parseFloat(taCs.lineHeight) || 21;

    // buildDoc() が**引擎自身で生成した行**の範囲（0基点・end 含む）。
    //   ・CSS 側＝値ボタン / スライダー / data-rule が作る規則ブロック
    //   ・HTML 側＝ data-slot が {{SLOT}} に流し込んだ断片
    // ＝この stage の主役。折りたたみ判定と初期ハイライトの両方がここを見る（2026-08-01 追加）。
    // 旧実装は主役を `data-selector` の文字列一致で判定していたため、data-rule / data-slot 型
    // （指南 §3.3 が data-selector 省略を認めている）では一致するはずが無く、主役ブロックが
    // 既定で畳まれていた（参考実装 #s-v16 で実測）。生成域から求めれば LAB の型に依存しない。
    var liveRanges = [];
    function buildDoc() {
      var css = baseCss, rule = '';
      if (ruleSlots.main || ruleSlots.extra) {
        // 二軸 LAB：軸1（main）と軸2（extra）のルールを、extra の順序指定に従って連結する
        var mainR = ruleSlots.main ? ruleSlots.main.text : '';
        var extraR = ruleSlots.extra ? ruleSlots.extra.text : '';
        var order = ruleSlots.extra ? ruleSlots.extra.order : 'after';
        if (mainR && extraR) rule = (order === 'before') ? (extraR + '\n' + mainR) : (mainR + '\n' + extraR);
        else rule = mainR || extraR || '';
      } else if (ruleOverride) {
        rule = ruleOverride;
      } else if (selector) {
        var decls = sortDecls(splitDecls(lab.dataset.fixed).concat(
          Object.keys(state).map(function (p) { return p + ': ' + state[p]; })));
        if (decls.length) rule = selector + ' {\n' + decls.map(function (d) { return '  ' + d + ';'; }).join('\n') + '\n}';
      }
      if (rule) css += '\n' + rule;
      var frag = slot;
      var html = frag ? injectSlot(baseHtml, frag) : baseHtml;

      // 生成域の行番号を確定する。定型の前置きは 5 行
      //（<!DOCTYPE> / <html> / <head> / <meta> / <style>）、
      // css の後ろに </style> </head> <body> の 3 行が入ってから html 区が始まる。
      var HEAD_LINES = 5;
      var cssLines = css.split('\n').length;
      var htmlStart = HEAD_LINES + cssLines + 3;
      liveRanges = [];
      if (rule) {
        var ruleLines = rule.split('\n').length;
        liveRanges.push({ start: HEAD_LINES + cssLines - ruleLines, end: HEAD_LINES + cssLines - 1 });
      }
      if (frag) {
        var slotIdx = -1, baseLines = baseHtml.split('\n');
        for (var i = 0; i < baseLines.length; i++) {
          if (/^[ \t]*\{\{SLOT\}\}[ \t]*$/.test(baseLines[i])) { slotIdx = i; break; }
        }
        if (slotIdx >= 0) {
          liveRanges.push({ start: htmlStart + slotIdx, end: htmlStart + slotIdx + frag.split('\n').length - 1 });
        }
      }
      return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<style>\n'
        + css + '\n</style>\n</head>\n<body>\n' + html + '\n</body>\n</html>';
    }
    // [start, end] が生成域と1行でも重なるか
    function overlapsLive(start, end) {
      return liveRanges.some(function (r) { return start <= r.end && end >= r.start; });
    }
    function liveLines() {
      var out = [];
      liveRanges.forEach(function (r) { for (var i = r.start; i <= r.end; i++) out.push(i); });
      return out;
    }

    function paint(doc, changedLines, noFlash) {
      hl.innerHTML = highlight(doc);
      if (changedLines && changedLines.length) {
        var cls = hl.querySelectorAll('.cl');
        // flash＝切り替えた瞬間の一過性のフラッシュ。chg＝次に値を変えるまで残る左端のマーカー。
        // 一過性だけだと「どこが変わったのか」を見逃した時に取り返せないため、印を残す。
        // noFlash＝初回描画。ページを開いた瞬間に LAB 全部が一斉に光るのは煩いので chg だけ付ける。
        changedLines.forEach(function (i) {
          if (!cls[i]) return;
          cls[i].classList.add('chg');
          if (!noFlash) cls[i].classList.add('flash');
        });
      }
      // ta は常時非表示（scrollHeight=0）なので、高さは hl の自然高に任せる
      hl.style.height = 'auto';
      applyZone(); // 現在のタブに応じて非担当領域の行を隠す
      applyFold(doc);
    }

    function applyZone() {
      var showZone = activeZone === 'html' ? ['head', 'body'] : ['style'];
      hl.querySelectorAll('[data-zone]').forEach(function (el) { // .cl 行が対象
        el.classList.toggle('zone-hidden', showZone.indexOf(el.dataset.zone) < 0);
      });
      // 講解対象（focusZone）側のタブを見ている時は、値ボタンの操作でこのコードが動くことを示す
      edWrap.classList.toggle('on-focus-zone', activeZone === focusZone);
    }

    var foldState = {}; // key: 'css-<start>' | 'head' → true(展開)/false(折畳み、缺省)
    // 【2026-07-31 修正】旧実装は閾値 6 行を head 区にも掛けていたが、buildDoc() が出す head 区は
    // <!DOCTYPE> / <html> / <head> / <meta> の 4 行固定。4 > 6 は永久に偽で、折りたたみが完全に死んでいた。
    // head 区は「行数に関わらず常に定型＝畳む」、CSS 補助ブロックだけ短さの閾値を見る、と役割を分ける。
    var FOLD_MIN_CSS_LINES = 3; // CSS 規則ブロックがこの行数以下なら畳まない（畳む方が読みにくい）

    // 折りたたみは VS Code と同じ作法：区画の先頭行はそのまま残し、その行末に「⋯」を付けて
    // 残りを隠す。「定型部分（DOCTYPE / head）4 行」のような説明文の行は挿入しない
    //（説明を読ませるためのものではなく、そこが畳まれていると分かればよいため）。
    function applyFold(doc) {
      var cls = hl.querySelectorAll('.cl');
      cls.forEach(function (cl) { cl.classList.remove('fold-hidden', 'folded', 'unfolded', 'foldable'); });
      hl.querySelectorAll('.fold-dots, .fold-arrow').forEach(function (n) { n.remove(); });

      // --- HTML tab: head 区（DOCTYPE / html / head / meta / </head>）は常に定型なので既定で畳む ---
      // </head> は <style>〜</style> の後ろにあり先頭4行と連続しない。行リストで畳む（区間だと
      // 間の CSS 行を巻き込む）。1行目だけ残し、</head> を含む残り全部を隠す。
      var headLines = [];
      cls.forEach(function (cl, i) { if (cl.dataset.zone === 'head') headLines.push(i); });
      if (headLines.length >= 2) foldLines(cls, headLines[0], headLines.slice(1), 'head');

      // --- CSS tab: 主役でない規則ブロックは既定折叠（短い場合は畳まない） ---
      findCssBlocks(doc).forEach(function (b) {
        if (overlapsLive(b.start, b.end)) return; // 主役＝引擎の生成域を含むブロックは常に展開のまま
        if (b.end - b.start + 1 <= FOLD_MIN_CSS_LINES) return; // 短いブロックはそのまま表示
        // 規則ブロックは閉じ括弧 } の行を残す（IDE の折りたたみは閉じ行を消さない）
        foldRange(cls, b.start, b.end, 'css-' + b.start, true);
      });

      // --- HTML tab: body 区のうち、この stage が講解している対象を含まないトップレベル要素は
      //     まるごと折り畳む（CSS 側と違い階層構造のため、行数のしきい値は見ない。
      //     2026-08-01 追加。対象＝ data-flash（無ければ data-selector）が示す要素）。
      var foldTargetSel = lab.dataset.flash || selector;
      if (foldTargetSel) {
        findHtmlBodyBlocks(doc).forEach(function (b) {
          if (overlapsLive(b.start, b.end)) return; // data-slot が差し込んだ主役は畳まない
          var chunk = doc.split('\n').slice(b.start, b.end + 1).join('\n');
          var tpl = document.createElement('template');
          tpl.innerHTML = chunk;
          var root = tpl.content.firstElementChild;
          try {
            if (root && (root.matches(foldTargetSel) || root.querySelector(foldTargetSel))) return; // 対象を含む要素は畳まない
          } catch (e) { return; } // セレクタが要素に不適合（クラス選択子等）なら安全側で畳まない
          foldRange(cls, b.start, b.end, 'html-' + b.start, true);
        });
      }
      applyZone(); // 現在の activeZone を反映し直す
    }

    // IDE（VS Code）と同じ畳み方：
    //   ① 行番号の gutter にシェブロン（既定は hover 時のみ表示）
    //   ② 先頭行はそのまま残し、行末に「⋯」の placeholder
    //   ③ **対になる閉じ行（} など）も残す** —— 隠すのは中身だけ
    //   ④ 隠れた行のぶん行番号が飛ぶ
    // 例：`5 > class Sub extends Sp {⋯` / `7   }` （6 行目だけが隠れる）
    // 説明文の行（「定型部分 4 行」等）は挿入しない。
    // keepLast=true のとき end 行を残す（閉じ行を持つブロック用）。
    // 2026-08-01 修正：以前は毎回の applyFold() 呼び出し（＝トグルするたび）で cls[start] という
    // **同じ DOM ノードに** addEventListener を積み増していた（このノードは hl.innerHTML の再構築
    // （＝ paint()）でしか作り直されず、toggle() 自身が呼ぶ applyFold() では作り直されない）。
    // クリックのたびにリスナーが1本ずつ増え、2回目以降のクリックで複数のリスナーが同時に発火して
    // 「反転→反転」で見た目上何も起きない（実際にクリック2回に1回ずつ発生することを実測で確認）。
    // 開閉の実処理はここでは行わず、hl 側の1本の委任リスナー（下記 bindFoldDelegation）に任せる。
    function foldRange(cls, start, end, key, keepLast) {
      var lastHidden = keepLast ? end - 1 : end, hidden = [];
      for (var i = start + 1; i <= lastHidden; i++) hidden.push(i);
      foldLines(cls, start, hidden, key);
    }
    // 隠す行を**リストで**受ける版。head 区は </head> が <style>〜</style> を挟んで離れた位置に
    // あるため連続区間では表せない（区間で畳むと間の CSS 行まで巻き込む）。2026-08-01 追加。
    function foldLines(cls, start, hidden, key) {
      var head = cls[start];
      if (!head || !hidden.length) return; // 隠す中身が無い＝畳む意味がない
      var expanded = !!foldState[key];
      if (!expanded) {
        hidden.forEach(function (i) { if (cls[i]) cls[i].classList.add('fold-hidden'); });
      }
      head.classList.add('foldable', expanded ? 'unfolded' : 'folded');
      head.dataset.foldKey = key; // 委任リスナーがここを読んで開閉する

      // ① gutter のシェブロン（グリフの出し分けは CSS 側。#s-v9 のようなロールは持たせない —
      //    行全体がクリック領域なので、矢印自体は装飾）
      var arrow = document.createElement('span');
      arrow.className = 'fold-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      head.insertBefore(arrow, head.firstChild);

      // ② 行そのものをクリックで開閉できる（展開／折畳みで対称。2026-08-01 修正）。
      //    「⋯」は畳んでいる時だけ付ける印（ボタンではなく、中身が隠れていることを示す）。
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      if (!expanded) {
        var dots = document.createElement('span');
        dots.className = 'fold-dots';
        dots.textContent = '⋯';
        head.appendChild(dots);
        head.title = hidden.length + ' 行を展開';
      } else {
        head.title = '折りたたむ';
      }
    }

    function diffLines(a, b) {
      var out = [];
      if (!a) return out;
      var la = a.split('\n'), lb = b.split('\n');
      // 共通の先頭行・共通の末尾行を取り除き、残った「中間の変化域」だけを変化とみなす
      // （行数の増減があっても、それより後ろの共通行を誤って変化扱いしない）
      var start = 0;
      var maxStart = Math.min(la.length, lb.length);
      while (start < maxStart && la[start] === lb[start]) start++;
      var aEnd = la.length - 1, bEnd = lb.length - 1;
      while (aEnd >= start && bEnd >= start && la[aEnd] === lb[bEnd]) { aEnd--; bEnd--; }
      for (var i = start; i <= bEnd; i++) out.push(i);
      // 中間域が空 = 純粋な削除（追加・変更行なし）。削除された位置に隣接する行を1つだけ光らせる
      if (out.length === 0 && la.length !== lb.length) {
        var near = start < lb.length ? start : lb.length - 1;
        if (near >= 0) out.push(near);
      }
      return out;
    }

    // コードは常に buildDoc() が生成する。ta.value は「表示中のコード＝iframe の中身」の唯一の源として
    // ここで同期し、機構としての一致（検証スクリプト項目2）を担保する。
    function apply() {
      var doc = buildDoc();
      // 初回は「直前の doc」が無いので diffLines() が空を返し、1行も印が付かなかった。
      // 結果、ページを開いた直後は代码框が全部素のままで、値を1回切り替えて初めて
      // 「この LAB が動かしている行」が分かる状態だった（2026-08-01 修正）。
      // 初回は生成域＝値ボタンが動かす行そのものを chg で示す（flash は付けない）。
      var first = lastDoc === '';
      var changed = first ? liveLines() : diffLines(lastDoc, doc);
      ta.value = doc;
      revealChanged(doc, changed);
      paint(doc, changed, first);
      frame.srcdoc = doc;
      lastDoc = doc;
      pendingFlash = !first && changed.length > 0;
    }

    // HTML と CSS が同時に変化することはない設計（値ボタンは focusZone の中だけを動かす）ため、
    // ここでは tab を切り替える必要はない。変化を含む CSS ブロックの折りたたみだけ強制解除する。
    function revealChanged(doc, changedLines) {
      if (!changedLines || !changedLines.length) return;
      findCssBlocks(doc).forEach(function (b) {
        for (var i = b.start; i <= b.end; i++) {
          if (changedLines.indexOf(i) >= 0) { foldState['css-' + b.start] = true; }
        }
      });
    }

    /* ---- スライダー専用：局所更新パス ----
       全量再構築（apply）は毎回 hl.innerHTML を丸ごと差し替え、frame.srcdoc を書き換えて iframe を
       再読み込みする。ドラッグ中に毎 tick これをやるとチラつき・:hover / スクロール位置の破棄が起きるため、
       スライダーだけは (1) 変化した行だけをハイライト層に書き戻し (2) iframe を再読込せず既存の
       CSSOM のルールを直接書き換える。条件を満たさない場合は必ず apply() に降格する。 */

    // 既存の highlight() と同じトークナイズ規則で、[0, uptoExclusive) 行ぶんの inStyle/depth 状態だけを追う
    function scanState(lines, uptoExclusive) {
      var inStyle = false, depth = 0;
      for (var i = 0; i < uptoExclusive; i++) {
        var line = lines[i];
        if (inStyle && !/<\/style>/.test(line)) {
          depth = hlCssLine(line, depth).depth;
        } else {
          if (/<style[^>]*>/.test(line)) { inStyle = true; depth = 0; }
          if (/<\/style>/.test(line)) inStyle = false;
        }
      }
      return { inStyle: inStyle, depth: depth };
    }
    // changedLines（doc 内の行インデックス）だけを再着色する。行数が変わっていないことが前提。
    function partialPaint(doc, changedLines) {
      var lines = doc.split('\n');
      var cls = hl.querySelectorAll('.cl');
      if (cls.length !== lines.length) { paint(doc, changedLines); return; } // 想定外：安全側で全量へ
      var minChanged = Math.min.apply(null, changedLines);
      var st = scanState(lines, minChanged);
      var inStyle = st.inStyle, depth = st.depth;
      changedLines.forEach(function (i) {
        var line = lines[i], html;
        if (inStyle && !/<\/style>/.test(line)) {
          var r = hlCssLine(line, depth); html = r.html; depth = r.depth;
        } else {
          html = hlHtmlLine(line);
          if (/<style[^>]*>/.test(line)) { inStyle = true; depth = 0; }
          if (/<\/style>/.test(line)) inStyle = false;
        }
        var node = cls[i]; if (!node) return;
        node.innerHTML = (html === '' ? '&#8203;' : html);
        node.classList.remove('flash');
        void node.offsetWidth; // アニメーション再始動のための強制リフロー
        node.classList.add('flash');
      });
      // hl の高さは直前の paint() が 'auto' に設定済み（行数はここでは変わらない）。
      // 2026-08-01 修正：旧実装は非表示の ta（display:none）の scrollHeight で hl を再計算しており、
      // 常に 0 になって hl が潰れていた（スライダー操作中に代码框が一瞬つぶれるバグの原因）。
    }
    // iframe 内の実スタイルシートから selector に一致する「最後の」ルールを探し、prop だけ書き換える。
    // 見つからない／反映が確認できない場合は false を返し、呼び出し側で全量再構築に降格させる。
    function updateRuleInFrame(prop, value) {
      var d = frame.contentDocument;
      if (!d) return false;
      var target = null;
      var sheets = d.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        var rules;
        try { rules = sheets[s].cssRules; } catch (e) { continue; }
        for (var i = 0; i < rules.length; i++) {
          var rr = rules[i];
          if (typeof rr.selectorText === 'string' && rr.selectorText.trim() === selector.trim()) target = rr;
        }
      }
      if (!target) return false;
      try {
        target.style.setProperty(prop, value);
        if (target.style.getPropertyValue(prop).trim() !== String(value).trim()) return false;
      } catch (e) { return false; }
      return true;
    }
    // frame 再読込を伴わないため 'load' イベントは発火しない。同じ高さ調整ロジックを手動で呼ぶ。
    // documentElement ではなく body の scrollHeight を見ることで、frame 自体の現在の高さに
    // 実測値が引っ張られる（縮まなくなる）のを避ける。
    function refreshFrameMetricsLocal() {
      var d = frame.contentDocument;
      if (!d) return;
      var measured = Math.max(minH, (d.body ? d.body.scrollHeight : 0) || d.documentElement.scrollHeight);
      if (curFrameH === 0 || measured > curFrameH || curFrameH - measured > SHRINK_THRESHOLD) curFrameH = measured;
      frame.style.height = curFrameH + 'px';
      clearOverlays();
      if (bmOn) drawBoxModel();
    }
    function applyLocal(prop, value) {
      if (!selector) { apply(); return; }
      var doc = buildDoc();
      var oldLines = lastDoc.split('\n'), newLines = doc.split('\n');
      if (oldLines.length !== newLines.length) { apply(); return; } // 行数が変わる状況は想定外
      var changed = diffLines(lastDoc, doc);
      // スライダー1操作は既存の1行の値だけを書き換えるはず。それ以外は局所更新の前提が崩れているため降格
      if (changed.length !== 1) { apply(); return; }
      if (!updateRuleInFrame(prop, value)) { apply(); return; }
      ta.value = doc;
      partialPaint(doc, changed);
      lastDoc = doc;
      refreshFrameMetricsLocal();
    }

    frame.addEventListener('load', function () {
      var d = frame.contentDocument;
      if (!d) return;
      // 先に最小まで縮めてから測る（縮まないまま測ると高さが増える一方になる）
      frame.style.height = minH + 'px';
      void d.documentElement.offsetHeight;
      var measured = Math.max(minH, d.documentElement.scrollHeight);
      // 増える時は即反映（中身が切れてはいけない）。減る時は SHRINK_THRESHOLD px 以上の差がある時だけ縮める
      // （スライダー操作中の1〜2px の微増減はヒステリシス幅の中に収まり、無視される）
      if (curFrameH === 0 || measured > curFrameH || curFrameH - measured > SHRINK_THRESHOLD) {
        curFrameH = measured;
      }
      frame.style.height = curFrameH + 'px';
      clearOverlays();
      if (bmOn) drawBoxModel();
      if (pendingFlash) { flashTarget(); pendingFlash = false; }
      if (lab.dataset.map) bindMap(d);
    });

    /* --- オーバーレイ（iframe の中身には一切触れず、上に描く） --- */
    function clearOverlays() {
      frameWrap.querySelectorAll('.ovl, .ovl-tag').forEach(function (n) { n.remove(); });
    }
    function rectOf(el) {
      var r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, h: r.height };
    }
    function addOvl(cls, box, label, pos) {
      var n = document.createElement('div');
      n.className = 'ovl ' + cls;
      n.style.cssText = 'left:' + box.l + 'px;top:' + box.t + 'px;width:' + box.w + 'px;height:' + box.h + 'px;';
      frameWrap.appendChild(n);
      if (label) {
        var t = document.createElement('span');
        t.className = 'ovl-tag';
        t.textContent = label;
        var right = frameWrap.clientWidth - box.l - box.w + 2;
        if (pos === 'tr') t.style.cssText = 'right:' + right + 'px;top:' + (box.t + 1) + 'px;';
        else if (pos === 'bl') t.style.cssText = 'left:' + (box.l + 2) + 'px;top:' + (box.t + box.h - 13) + 'px;';
        else if (pos === 'br') t.style.cssText = 'right:' + right + 'px;top:' + (box.t + box.h - 13) + 'px;';
        else t.style.cssText = 'left:' + (box.l + 2) + 'px;top:' + (box.t + 1) + 'px;';
        frameWrap.appendChild(t);
      }
      return n;
    }
    function target() {
      var d = frame.contentDocument;
      var sel = lab.dataset.flash || selector;   // HTML 切替型 LAB は data-flash で対象を指定
      return (d && sel) ? d.querySelector(sel) : null;
    }
    function flashTarget() {
      var el = target(); if (!el) return;
      var n = addOvl('ovl-flash', rectOf(el));
      setTimeout(function () { n.remove(); }, 950);
    }

    /* --- D02 ボックスモデル可視化 --- */
    var bmOn = false;
    function px(v) { return parseFloat(v) || 0; }
    function drawBoxModel() {
      var el = target(); if (!el) return;
      var r = rectOf(el), cs = frame.contentWindow.getComputedStyle(el);
      var mt = px(cs.marginTop), mr = px(cs.marginRight), mb = px(cs.marginBottom), ml = px(cs.marginLeft);
      var bt = px(cs.borderTopWidth), br = px(cs.borderRightWidth), bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth);
      var pt = px(cs.paddingTop), pr = px(cs.paddingRight), pb = px(cs.paddingBottom), pl = px(cs.paddingLeft);
      addOvl('ovl-m', { l: r.l - ml, t: r.t - mt, w: r.w + ml + mr, h: r.h + mt + mb }, 'margin ' + cs.marginTop, 'tl');
      addOvl('ovl-b', { l: r.l, t: r.t, w: r.w, h: r.h }, 'border ' + cs.borderTopWidth, 'tr');
      addOvl('ovl-p', { l: r.l + bl, t: r.t + bt, w: r.w - bl - br, h: r.h - bt - bb }, 'padding ' + cs.paddingTop, 'bl');
      addOvl('ovl-c', { l: r.l + bl + pl, t: r.t + bt + pt, w: r.w - bl - br - pl - pr, h: r.h - bt - bb - pt - pb },
        Math.round(r.w - bl - br - pl - pr) + '×' + Math.round(r.h - bt - bb - pt - pb), 'br');
    }
    var bmSw = lab.querySelector('[data-bm]');
    if (bmSw) {
      var toggleBm = function () {
        bmOn = !bmOn;
        bmSw.classList.toggle('on', bmOn);
        bmSw.setAttribute('aria-checked', String(bmOn));
        clearOverlays();
        if (bmOn) drawBoxModel();
      };
      bmSw.addEventListener('click', toggleBm);
      bmSw.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleBm(); }
      });
    }

    /* --- D01 コード ↔ 要素 の対応付け --- */
    var mapNames = (lab.dataset.map || '').split(',').filter(Boolean);
    var hlOvl = null;
    function highlightEl(name, on) {
      if (hlOvl) { hlOvl.remove(); hlOvl = null; }
      var cls = hl.querySelectorAll('.cl');
      ta.value.split('\n').forEach(function (l, i) {
        if (l.indexOf('<' + name) >= 0 && cls[i]) cls[i].classList.toggle('mark', on);
      });
      if (!on) return;
      var d = frame.contentDocument; if (!d) return;
      var el = d.querySelector(name); if (!el) return;
      hlOvl = addOvl('ovl-hl', rectOf(el));
    }
    function bindMap(d) {
      mapNames.forEach(function (name) {
        var el = d.querySelector(name); if (!el) return;
        el.addEventListener('mouseenter', function () { highlightEl(name, true); });
        el.addEventListener('mouseleave', function () { highlightEl(name, false); });
      });
    }
    if (mapNames.length) {
      var lastName = null;
      // ta は常時非表示になったため、hover 判定は表示されている .ed-hl 側で行う。
      // 行の特定も offsetY ÷ 行高の計算ではなく、実際にホバーしている .cl 要素そのものから取る
      // （折りたたみで行が消えている時に計算がずれる問題も同時に解消する）。
      hl.addEventListener('mousemove', function (e) {
        var cl = e.target.closest ? e.target.closest('.cl') : null;
        var text = cl ? cl.textContent : '';
        var found = null;
        mapNames.forEach(function (n) { if (text.indexOf('<' + n) >= 0) found = n; });
        if (found !== lastName) {
          if (lastName) highlightEl(lastName, false);
          if (found) highlightEl(found, true);
          lastName = found;
        }
      });
      hl.addEventListener('mouseleave', function () {
        if (lastName) { highlightEl(lastName, false); lastName = null; }
      });
    }


    /* --- 値ボタン（グループ内で排他）・スライダー --- */
    var groupLast = new WeakMap();   // .vbtns → 直前に押されたボタン（宣言の消し込み用）
    function setDecls(el, grp) {
      grp = grp || el.closest('.vbtns') || lab;
      var prev = groupLast.get(grp);
      if (prev && prev !== el) {   // 同じグループの前の選択が入れた宣言を消す
        splitDecls(prev.dataset.css).forEach(function (d) { delete state[d.split(':')[0].trim()]; });
      }
      splitDecls(el.dataset.css).forEach(function (d) {
        var i = d.indexOf(':');
        state[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      });
      groupLast.set(grp, el);
    }
    // 値を1つ選ぶ操作の本体。ボタン（.vbtn）とドロップダウンの選択肢（.vsel > option）で共用する。
    // grp = 排他の単位（ボタンなら .vbtns、ドロップダウンなら select そのもの）
    function pickValue(el, grp) {
      if (el.dataset.css) setDecls(el, grp);
      if (el.dataset.rule != null) {
        var slotName = el.dataset.ruleSlot || '';
        if (slotName) ruleSlots[slotName] = { text: el.dataset.rule, order: el.dataset.ruleOrder || 'after' };
        else ruleOverride = el.dataset.rule;
      }
      if (el.dataset.slot != null) slot = el.dataset.slot;
      if (el.dataset.note != null) noteEl.textContent = el.dataset.note;
    }
    lab.querySelectorAll('.vbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pickValue(btn, btn.closest('.vbtns') || lab);
        // 排他の範囲：rule はグループ（.vbtns）内で1つ（＝軸ごとに独立）、slot は LAB 全体で1つ、CSS 宣言はグループ内で1つ
        var scope;
        if (btn.dataset.rule != null) scope = (btn.closest('.vbtns') || lab).querySelectorAll('.vbtn[data-rule]');
        else if (btn.dataset.slot != null) scope = lab.querySelectorAll('.vbtn[data-slot]');
        else scope = (btn.closest('.vbtns') || lab).querySelectorAll('.vbtn');
        scope.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        apply();
      });
    });
    // ドロップダウン（値が多くてボタン行に収まらないプロパティ用。option 側に data-* を書く）
    lab.querySelectorAll('.vsel').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var opt = sel.options[sel.selectedIndex];
        if (!opt) return;
        pickValue(opt, sel);
        apply();
      });
    });
    lab.querySelectorAll('.vrange').forEach(function (r) {
      var valEl = r.closest('.vrange-row').querySelector('.vval');
      r.addEventListener('input', function () {
        var value = r.value + (r.dataset.unit || '');
        state[r.dataset.prop] = value;
        if (valEl) valEl.textContent = r.value + (r.dataset.unit || '');
        applyLocal(r.dataset.prop, value); // ドラッグ中：局所更新（条件を満たさなければ内部で全量へ降格）
      });
      r.addEventListener('change', function () {
        apply(); // 離した瞬間：一致性の担保として必ず全量再構築（iframe とコード框を強制的に揃える）
      });
    });

    /* --- コード框は読み取り専用。編集機能は 2026-07-31 に撤去した ---
       理由：編集モードは折りたたみ・zone 表示・高さ計算と噛み合わず不具合の温床だった。
       ta（textarea）は DOM に残すが常時非表示。ta.value は iframe.srcdoc の唯一の源として
       機構一致性の担保に使い続ける（検証スクリプト項目2・hover 対応表示もこれに依存）。 */
    ta.readOnly = true;

    /* --- B5 ツールバー --- */
    function flashBtn(b, msg) {
      var keep = b.innerHTML;
      b.textContent = msg;
      setTimeout(function () { b.innerHTML = keep; }, 1300);
    }
    // コピーボタンはコード領域の右上に重ねて置く（ツールバー1本ぶん横帯を減らすため）。
    // .html として保存する機能は 2026-07-31 に撤去（コピーがあれば足りる）。
    var copyBtn = edWrap.querySelector('.ibtn[data-act="copy"]');
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(ta.value)
        .then(function () { flashBtn(copyBtn, '済'); }, function () { flashBtn(copyBtn, '失敗'); });
    });

    var tabButtons = body.querySelectorAll('.ed-tab');
    function setActiveTab(zone) {
      activeZone = zone;
      tabButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.zone === zone); });
      applyZone();
    }
    tabButtons.forEach(function (b) {
      b.addEventListener('click', function () { setActiveTab(b.dataset.zone); });
    });
    setActiveTab(activeZone); // 初期状態

    /* --- 初期状態 --- */
    lab.querySelectorAll('.vrange').forEach(function (r) {
      state[r.dataset.prop] = r.value + (r.dataset.unit || '');
      var v = r.closest('.vrange-row').querySelector('.vval');
      if (v) v.textContent = r.value + (r.dataset.unit || '');
    });
    var firstNote = null;
    lab.querySelectorAll('.vbtn.active').forEach(function (btn) {
      if (btn.dataset.css) setDecls(btn);
      if (btn.dataset.rule != null) {
        var slotName = btn.dataset.ruleSlot || '';
        if (slotName) { if (!ruleSlots[slotName]) ruleSlots[slotName] = { text: btn.dataset.rule, order: btn.dataset.ruleOrder || 'after' }; }
        else if (!ruleOverride) ruleOverride = btn.dataset.rule;
      }
      if (btn.dataset.slot != null && !slot) slot = btn.dataset.slot;
      if (firstNote === null && btn.dataset.note != null) firstNote = btn.dataset.note;
    });
    // ドロップダウンの初期状態＝選択されている option（＝ selected 属性、無ければ先頭）
    lab.querySelectorAll('.vsel').forEach(function (sel) {
      var opt = sel.options[sel.selectedIndex];
      if (!opt) return;
      if (opt.dataset.css) setDecls(opt, sel);
      if (opt.dataset.rule != null) {
        var slotName = opt.dataset.ruleSlot || '';
        if (slotName) { if (!ruleSlots[slotName]) ruleSlots[slotName] = { text: opt.dataset.rule, order: opt.dataset.ruleOrder || 'after' }; }
        else if (!ruleOverride) ruleOverride = opt.dataset.rule;
      }
      if (opt.dataset.slot != null && !slot) slot = opt.dataset.slot;
      if (firstNote === null && opt.dataset.note != null) firstNote = opt.dataset.note;
    });
    if (firstNote !== null) noteEl.textContent = firstNote;
    else if (lab.dataset.goodNote) noteEl.textContent = lab.dataset.goodNote;
    measureNoteMinH();
    apply();

    window.addEventListener('resize', function () {
      clearOverlays();
      if (bmOn) drawBoxModel();
    });
  });

  /* ================= rail スクロールスパイ ================= */
  var links = Array.prototype.slice.call(document.querySelectorAll('.rail a'));
  var map = new Map();
  links.forEach(function (a) {
    var sec = document.querySelector(a.getAttribute('href'));
    if (sec) map.set(sec, a);
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove('active'); a.removeAttribute('aria-current'); });
      var a = map.get(e.target);
      if (a) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'true');
        a.parentElement.scrollTo({ left: a.offsetLeft - 80, behavior: 'smooth' });
      }
    });
  }, { rootMargin: '-15% 0px -70% 0px' });
  map.forEach(function (a, sec) { io.observe(sec); });

  /* ================= kicker → 門戸ページへ戻るリンク =================
     全ページ共通でこのファイルを読むため、ここに1回書けば各ページを
     個別に編集しなくても .kicker がリンク化される（index.html 自体は
     このスクリプトを読まないので対象外）。 */
  var kicker = document.querySelector('.masthead .kicker');
  if (kicker && !kicker.querySelector('a')) {
    var backLink = document.createElement('a');
    backLink.href = 'index.html';
    backLink.textContent = '← ' + kicker.textContent;
    backLink.style.color = 'inherit';
    backLink.style.textDecoration = 'none';
    kicker.textContent = '';
    kicker.appendChild(backLink);
  }
})();
