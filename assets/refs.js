/* ============================================================
   参考书目阅读器
   - 画布区自己滚（body 不滚），滚轮事件不会传给页面
   - 左侧章节目录点击跳到对应 PDF 页
   - 页面按需渲染 + 远离视口后释放，六百页的书也不会吃满内存
   ============================================================ */
import * as pdfjsLib from './pdfjs/pdf.min.mjs';

const cfg = JSON.parse(document.getElementById('rf-cfg').textContent);
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const viewer = document.getElementById('rf-viewer');
const pagesEl = document.getElementById('rf-pages');
const posEl = document.getElementById('rf-pos');
const zoomEl = document.getElementById('rf-zoom');
const sideEl = document.getElementById('rf-side');

/* ---------------- 状态 ---------------- */
let pdf = null;
let numPages = 0;
let ratios = [];            // 每页的 高/宽
let zoom = 1;               // 用户缩放倍率（相对「适应宽度」）
let baseW = 800;            // 适应宽度时的 CSS 宽度
const renders = new Map();  // pageNo -> canvas
const visible = new Set();
const placeholders = [];    // 按页序
let tops = [];              // 每页相对画布区顶部的偏移

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const MAXW = 1180;
const GAP = 14;
const BAR = 42;             // 顶部工具条高度，跳页时让开
const KEEP = 28;            // 常驻 canvas 上限

function fitBaseWidth() {
  const pad = window.innerWidth <= 900 ? 16 : 32;
  baseW = Math.max(280, Math.min(MAXW, viewer.clientWidth - pad));
}

/* ---------------- 占位块 ---------------- */
function buildPlaceholders() {
  pagesEl.textContent = '';
  placeholders.length = 0;
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= numPages; n++) {
    const d = document.createElement('div');
    d.className = 'rf-page';
    d.dataset.p = String(n);
    const w = Math.round(baseW * zoom);
    d.style.width = w + 'px';
    d.style.height = Math.round(w * (ratios[n - 1] || 1.414)) + 'px';
    d.innerHTML = '<span class="rf-ph">' + n + '</span>';
    placeholders.push(d);
    frag.appendChild(d);
  }
  pagesEl.appendChild(frag);
}

function layoutSizes() {
  const w = Math.round(baseW * zoom);
  placeholders.forEach((d, i) => {
    d.style.width = w + 'px';
    d.style.height = Math.round(w * (ratios[i] || 1.414)) + 'px';
  });
}

/* ---------------- 渲染 ---------------- */
async function renderPage(n) {
  if (renders.has(n)) return;
  const d = placeholders[n - 1];
  if (!d || d.dataset.rendering) return;
  const token = String(n);
  d.dataset.rendering = token;
  try {
    const page = await pdf.getPage(n);
    if (d.dataset.rendering !== token) return;
    const vp0 = page.getViewport({ scale: 1 });
    const r = vp0.height / vp0.width;
    // 个别书里有横排大图表页，比例不同，渲染时顺手修正占位高度
    if (Math.abs(r - (ratios[n - 1] || 0)) > 0.004) {
      ratios[n - 1] = r;
      d.style.height = Math.round(parseFloat(d.style.width) * r) + 'px';
    }
    const scale = (parseFloat(d.style.width) * DPR) / vp0.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (d.dataset.rendering !== token) return;
    const ph = d.querySelector('.rf-ph');
    if (ph) ph.remove();
    d.appendChild(canvas);
    renders.set(n, canvas);
    evict();
  } catch (e) {
    if (!/Rendering cancelled|same canvas|Cannot use the same canvas/i.test(String(e))) {
      console.warn('render page ' + n, e);
    }
  } finally {
    if (d.dataset.rendering === token) delete d.dataset.rendering;
  }
}

function addPh(n) {
  const d = placeholders[n - 1];
  if (!d || d.querySelector('.rf-ph')) return;
  const ph = document.createElement('span');
  ph.className = 'rf-ph';
  ph.textContent = n;
  d.appendChild(ph);
}

function evict() {
  if (renders.size <= KEEP) return;
  const cur = currentPage();
  const nums = [...renders.keys()]
    .filter((n) => !visible.has(n))
    .sort((a, b) => Math.abs(b - cur) - Math.abs(a - cur));
  for (const n of nums) {
    if (renders.size <= KEEP) break;
    const c = renders.get(n);
    const d = placeholders[n - 1];
    if (c && c.parentNode) c.parentNode.removeChild(c);
    addPh(n);
    renders.delete(n);
  }
}

/* ---------------- 位置与目录联动 ---------------- */
function measure() {
  const top0 = viewer.getBoundingClientRect().top - viewer.scrollTop;
  tops = placeholders.map((d) => d.getBoundingClientRect().top - top0);
}

let measureTimer = 0;
function scheduleMeasure() {
  clearTimeout(measureTimer);
  measureTimer = setTimeout(measure, 140);
}

function currentPage() {
  if (!tops.length) return 1;
  const y = viewer.scrollTop + BAR + 48;
  let lo = 0, hi = tops.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= y) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans + 1;
}

let lastPage = 0;
function syncToc() {
  const p = currentPage();
  if (p === lastPage) return;
  lastPage = p;
  posEl.innerHTML = '第 <b>' + p + '</b> / ' + numPages + ' 页';
  let cur = -1;
  cfg.toc.forEach((s, i) => { if (s.p <= p) cur = i; });
  sideEl.querySelectorAll('.rf-ch').forEach((a) => {
    a.classList.toggle('cur', Number(a.dataset.toc) === cur);
  });
}

function gotoPage(p, smooth) {
  p = Math.max(1, Math.min(numPages, Math.round(p) || 1));
  measure();
  const y = tops[p - 1];
  if (y == null) return;
  viewer.scrollTo({ top: Math.max(0, y - BAR - 10), behavior: smooth ? 'smooth' : 'auto' });
  lastPage = 0;
  syncToc();
}

/* ---------------- 缩放 ---------------- */
function applyZoom(z, anchorPage) {
  const p = Math.max(1, Math.min(numPages, anchorPage || currentPage()));
  const h = parseFloat(placeholders[p - 1].style.height) || 1;
  const y0 = tops[p - 1] == null ? viewer.scrollTop : tops[p - 1];
  const frac = Math.min(1, Math.max(0, (viewer.scrollTop - y0) / (h + GAP)));

  zoom = Math.max(0.5, Math.min(3, z));
  zoomEl.textContent = Math.round(zoom * 100) + '%';

  for (const [n, c] of renders) {
    if (c.parentNode) c.parentNode.removeChild(c);
    addPh(n);
  }
  renders.clear();
  layoutSizes();
  measure();

  const y = tops[p - 1];
  if (y != null) {
    const nh = parseFloat(placeholders[p - 1].style.height) || 1;
    viewer.scrollTop = Math.max(0, y - BAR - 10 + frac * (nh + GAP));
  }
  reobserve();
  lastPage = 0;
  syncToc();
}

/* ---------------- 观察器 ---------------- */
let io = null;
function reobserve() {
  if (io) io.disconnect();
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = Number(e.target.dataset.p);
        if (e.isIntersecting) { visible.add(n); renderPage(n); }
        else visible.delete(n);
      }
    },
    { root: viewer, rootMargin: '700px 0px', threshold: 0 }
  );
  placeholders.forEach((d) => io.observe(d));
}

/* ---------------- 主流程 ---------------- */
async function boot() {
  try {
    const task = pdfjsLib.getDocument({
      url: cfg.file,
      cMapUrl: new URL('./pdfjs/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./pdfjs/standard_fonts/', import.meta.url).href,
    });
    task.onProgress = ({ loaded, total }) => {
      if (total && loaded <= total) posEl.textContent = '载入中 ' + Math.round((loaded / total) * 100) + '%';
    };
    pdf = await task.promise;
    numPages = pdf.numPages;
    ratios = new Array(numPages).fill(0);

    // 用前几页里出现最多的比例当全书的默认比例（第 1 页常是封面，不能只看它）
    const probe = Math.min(numPages, 6);
    const seen = new Map();
    for (let i = 1; i <= probe; i++) {
      const pg = await pdf.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const r = Math.round((vp.height / vp.width) * 1000) / 1000;
      seen.set(r, (seen.get(r) || 0) + 1);
    }
    ratios.fill([...seen.entries()].sort((a, b) => b[1] - a[1])[0][0]);

    fitBaseWidth();
    buildPlaceholders();
    zoomEl.textContent = '100%';
    measure();
    reobserve();
    syncToc();

    viewer.addEventListener('scroll', () => { syncToc(); scheduleMeasure(); }, { passive: true });
    window.addEventListener('resize', () => {
      const before = baseW;
      fitBaseWidth();
      if (Math.abs(before - baseW) > 2) applyZoom(zoom, currentPage());
      else scheduleMeasure();
    });

    // ?p=12 直达某页
    const qp = new URLSearchParams(location.search).get('p');
    if (qp) requestAnimationFrame(() => gotoPage(parseInt(qp, 10)));
  } catch (e) {
    console.error(e);
    pagesEl.innerHTML =
      '<div class="rf-err"><b>PDF 没能载入</b>' +
      '如果网络正常而这里一直是空白，可能是 pdf.js 的 worker 被拦住了，刷新重试即可；' +
      '也可以从左栏底部直接下载这份 PDF 用本地阅读器打开。</div>';
  }
}

/* ---------------- 控件 ---------------- */
document.getElementById('rf-zin').addEventListener('click', () => applyZoom(zoom * 1.15));
document.getElementById('rf-zout').addEventListener('click', () => applyZoom(zoom / 1.15));
zoomEl.addEventListener('click', () => applyZoom(1));
document.getElementById('rf-up').addEventListener('click', () => viewer.scrollBy({ top: -viewer.clientHeight * 0.9, behavior: 'smooth' }));
document.getElementById('rf-down').addEventListener('click', () => viewer.scrollBy({ top: viewer.clientHeight * 0.9, behavior: 'smooth' }));

const menuBtn = document.getElementById('rf-menubtn');
const scrim = document.getElementById('rf-scrim');
function closeDrawer() { sideEl.classList.remove('open'); scrim.classList.remove('on'); }
menuBtn.addEventListener('click', () => {
  sideEl.classList.toggle('open');
  scrim.classList.toggle('on', sideEl.classList.contains('open'));
});
scrim.addEventListener('click', closeDrawer);

sideEl.querySelectorAll('.rf-ch').forEach((a) => {
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeDrawer();
    gotoPage(Number(a.dataset.p), true);
  });
});

// 键盘翻页（焦点在输入控件里时不抢）
document.addEventListener('keydown', (ev) => {
  if (ev.target.closest('input, textarea, select')) return;
  const step = viewer.clientHeight * 0.9;
  if (ev.key === 'PageDown' || (ev.key === ' ' && !ev.shiftKey)) {
    viewer.scrollBy({ top: step, behavior: 'smooth' }); ev.preventDefault();
  } else if (ev.key === 'PageUp' || (ev.key === ' ' && ev.shiftKey)) {
    viewer.scrollBy({ top: -step, behavior: 'smooth' }); ev.preventDefault();
  } else if (ev.key === 'Home') {
    viewer.scrollTo({ top: 0 }); ev.preventDefault();
  } else if (ev.key === 'End') {
    viewer.scrollTo({ top: viewer.scrollHeight }); ev.preventDefault();
  }
});

boot();
