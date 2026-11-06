// 阅读页交互：侧栏目录高亮 / 锚点复制 / 左右方向键翻章 / 回到顶部
(function () {
  'use strict';

  // ---------- 1. 侧栏当前小节高亮 ----------
  var secLinks = Array.prototype.slice.call(document.querySelectorAll('.sb-sec'));
  var heads = Array.prototype.slice.call(
    document.querySelectorAll('.section-title, .subsection-title')
  );

  if (secLinks.length && heads.length && 'IntersectionObserver' in window) {
    var byId = {};
    secLinks.forEach(function (a) {
      var id = (a.getAttribute('href') || '').replace(/^#/, '');
      if (id) byId[id] = a;
    });
    var visible = new Set();
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        });
        var first = null;
        for (var i = 0; i < heads.length; i++) {
          if (visible.has(heads[i].id)) { first = heads[i].id; break; }
        }
        secLinks.forEach(function (a) { a.classList.remove('cur'); });
        if (first && byId[first]) byId[first].classList.add('cur');
      },
      { rootMargin: '-72px 0px -65% 0px', threshold: 0 }
    );
    heads.forEach(function (h) { if (h.id) io.observe(h); });
  }

  // ---------- 2. 标题悬停出现 ¶ 可复制锚点 ----------
  heads.forEach(function (h) {
    if (!h.id) return;
    var a = document.createElement('a');
    a.className = 'anchor-link';
    a.href = '#' + h.id;
    a.textContent = '¶';
    a.setAttribute('aria-label', '复制本节链接');
    a.addEventListener('click', function (ev) {
      var url = location.origin + location.pathname + '#' + h.id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(function () {});
      }
      // 不阻止默认，浏览器仍会跳转并写入地址栏
      ev.stopPropagation();
      setTimeout(function () { history.replaceState(null, '', '#' + h.id); }, 0);
    });
    h.appendChild(a);
  });

  // ---------- 3. 左右方向键翻章 ----------
  var prev = document.querySelector('.pager-prev');
  var next = document.querySelector('.pager-next');
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft' && prev) location.href = prev.href;
    else if (e.key === 'ArrowRight' && next && !e.shiftKey) location.href = next.href;
  });

  // ---------- 4. 公式/定理点按高亮（复制锚点） ----------
  document.querySelectorAll('.thm[id], .eq[id]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var sel = window.getSelection();
      if (sel && String(sel).length > 3) return; // 用户正在选文字就不打扰
      var url = location.origin + location.pathname + '#' + el.id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(function () {});
      }
      history.replaceState(null, '', '#' + el.id);
    });
  });

  // ---------- 5. 回到顶部 ----------
  var toTop = document.createElement('button');
  toTop.className = 'to-top';
  toTop.type = 'button';
  toTop.title = '回到顶部';
  toTop.textContent = '回到顶部';
  toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.body.appendChild(toTop);
  var onScroll = function () {
    toTop.classList.toggle('show', window.scrollY > 900);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
