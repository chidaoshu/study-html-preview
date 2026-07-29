/* ============================================================
   review-hl.js — 要点復習版の表示層のみ
     ① SQL シンタックスハイライト（One Dark Pro 配色）
     ② ⟦…⟧ で囲んだ範囲を「変化点」として <mark> 化
     ③ 変化スイッチ（同一構文のバリアント切替）
   SQL は一切実行しない。失敗してもコードは素のまま読める。
   ============================================================ */
(function () {
  'use strict';

  var KW = new Set(('SELECT,FROM,WHERE,ORDER,BY,GROUP,HAVING,ASC,DESC,NULLS,FIRST,LAST,' +
    'FETCH,NEXT,ROW,ROWS,ONLY,WITH,TIES,OFFSET,PERCENT,DISTINCT,ALL,AS,AND,OR,NOT,' +
    'IN,BETWEEN,LIKE,IS,NULL,ESCAPE,CASE,WHEN,THEN,ELSE,END,' +
    'JOIN,INNER,OUTER,LEFT,RIGHT,FULL,CROSS,NATURAL,USING,ON,UNION,INTERSECT,MINUS,' +
    'ANY,SOME,EXISTS,DUAL,INSERT,INTO,VALUES,UPDATE,SET,DELETE,' +
    'CREATE,TABLE,VIEW,ALTER,DROP,COMMIT,ROLLBACK').split(','));

  var TOK = /(--[^\n]*)|('(?:''|[^'])*')|("[^"]*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_À-ÿ][A-Za-z_0-9À-ÿ]*)|([<>=!+\-*\/|%,;().])/g;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 1 セグメントを着色 */
  function paint(src) {
    var out = '', last = 0, m;
    TOK.lastIndex = 0;
    while ((m = TOK.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      var t = m[0], c;
      if (m[1]) c = 'com';
      else if (m[2] || m[3]) c = 'str';
      else if (m[4]) c = 'num';
      else if (m[5]) c = KW.has(t.toUpperCase()) ? 'kw' : 'id';
      else c = 'op';
      out += '<span class="' + c + '">' + esc(t) + '</span>';
      last = m.index + t.length;
    }
    return out + esc(src.slice(last));
  }

  /* ⟦…⟧ を <mark> に。中身も通常どおり着色する */
  function render(src) {
    var parts = src.split(/⟦|⟧/), html = '';
    for (var i = 0; i < parts.length; i++) {
      html += (i % 2 === 1)
        ? '<mark>' + paint(parts[i]) + '</mark>'
        : paint(parts[i]);
    }
    return html;
  }

  function highlightAll(root) {
    /* code.code は一行例を .demo へ格上げしたときの SQL（指南 §4-4・2026-07-29） */
    (root || document).querySelectorAll('pre.code, code.code').forEach(function (p) {
      if (p.dataset.done) return;
      try {
        p.innerHTML = render(p.textContent);
        p.dataset.done = '1';
      } catch (e) { /* 素のまま */ }
    });
  }

  /* 変化スイッチ */
  function flash(box) {
    box.querySelectorAll('pre.code mark, code.code mark').forEach(function (m) {
      m.classList.remove('fx');
      void m.offsetWidth;          /* reflow で再生 */
      m.classList.add('fx');
    });
  }

  function bindSwitches(root) {
    (root || document).querySelectorAll('.demo').forEach(function (demo) {
      if (demo.dataset.swBound) return;
      var btns = demo.querySelectorAll('.sw button');
      var vars = demo.querySelectorAll('.vars > .var');
      if (!btns.length || !vars.length) return;

      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.dataset.v;
          btns.forEach(function (x) { x.classList.toggle('on', x === b); });
          var shown = null;
          vars.forEach(function (p) {
            var on = p.dataset.v === v;
            p.hidden = !on;
            if (on) shown = p;
          });
          if (shown) flash(shown);
        });
      });
      demo.dataset.swBound = '1';
    });
  }

  function start(root) {
    highlightAll(root);
    bindSwitches(root);
  }

  // Export for dynamic content loading (e.g. index.html)
  window.ReviewHL = {
    start: start,
    highlightAll: highlightAll,
    bindSwitches: bindSwitches
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { start(); });
  } else {
    start();
  }
})();
