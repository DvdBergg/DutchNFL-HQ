// Save the League page as one or two sharp poster images: laid out at phone width, cut between cards and rows, set side by side in columns.
(() => {
  const SKIP = /^(animation|transition|will-change|cursor|pointer-events|caret-color|view-transition|interactivity|content-visibility|-webkit-tap|scroll-|overscroll|touch-action|user-select|-webkit-user)/;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_GEO = new Set(['x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd']);
  const SHOT_W = 600;      // layout width in CSS px, a phone-like column
  const fixUrl = (v) => v.indexOf('url(') < 0 ? v : v.replace(/url\("?[^)"]*?(#[^)"]+)"?\)/g, 'url($1)');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function bgOf(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return '#0b0b0c';
  }
  const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

  async function fontCss(usedText) {
    let out = '';
    for (const sheet of Array.from(document.styleSheets)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of Array.from(rules || [])) {
        if (r.type !== 5) continue;
        const fam = (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim();
        if (!fam || usedText.indexOf(fam) < 0) continue;
        const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(r.style.getPropertyValue('src') || '');
        if (!m) continue;
        try {
          const resp = await fetch(m[1]); if (!resp.ok) continue;
          out += '@font-face{font-family:"' + fam + '";font-weight:' + (r.style.getPropertyValue('font-weight') || '400') + ';font-style:' + (r.style.getPropertyValue('font-style') || 'normal') + ';src:url(' + await toDataUrl(await resp.blob()) + ');}';
        } catch (e) { /* falls back to a system font */ }
      }
    }
    return out;
  }

  // Sizes the stylesheet actually sets. Anything left to the browser ("auto") stays free in the
  // picture, so a slightly different font can never push text out of a frozen box.
  const SIZE = new Set(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'flex-basis', 'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows']);
  const LOGICAL = /^(inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size)$/;
  const REPLACED = /^(img|svg|canvas|video|input|select|textarea|iframe|progress|meter)$/;
  const specOf = (sel) => { const t = sel.replace(/\([^)]*\)/g, (m) => m.replace(/[.#[:]/g, '')); return (t.match(/#[\w-]+/g) || []).length * 100 + (t.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (t.replace(/::?[\w-]+/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length; };
  function sizeRules() {
    const out = []; let order = 0;
    const take = (rules) => {
      for (const r of Array.from(rules || [])) {
        if (r.type === 4) { try { if (window.matchMedia(r.conditionText || r.media.mediaText).matches) take(r.cssRules); } catch (e) {} continue; }
        if (r.type === 12) { take(r.cssRules); continue; }
        if (r.type !== 1) continue;
        const props = {};
        for (const p of SIZE) { const v = r.style.getPropertyValue(p); if (v) props[p] = v; }
        if (Object.keys(props).length) out.push({parts: r.selectorText.split(/,(?![^(]*\))/).map((x) => x.trim()), props, order: order++});
      }
    };
    for (const sheet of Array.from(document.styleSheets)) { try { take(sheet.cssRules); } catch (e) {} }
    return (el) => {
      const best = {};
      for (const r of out) {
        let sp = -1;
        for (const part of r.parts) { try { if (el.matches(part)) sp = Math.max(sp, specOf(part)); } catch (e) {} }
        if (sp < 0) continue;
        for (const p in r.props) { const b = best[p]; if (!b || sp > b.sp || (sp === b.sp && r.order > b.order)) best[p] = {sp, order: r.order, v: r.props[p]}; }
      }
      const o = {};
      for (const p in best) o[p] = best[p].v;
      for (const p of SIZE) { const v = el.style && el.style.getPropertyValue(p); if (v) o[p] = v; }
      return o;
    };
  }

  // Copies the page's look into inline styles so it can be drawn as one SVG picture.
  function cloneStyled(src, scratch) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden;';
    scratch.appendChild(host);
    const shadow = host.attachShadow({mode: 'open'});
    const svgBox = document.createElementNS(SVG_NS, 'svg'); shadow.appendChild(svgBox);
    const bases = new Map();
    const baseOf = (el) => {
      const key = el.namespaceURI + '|' + el.localName;
      if (!bases.has(key)) {
        const b = document.createElementNS(el.namespaceURI, el.localName);
        (el.namespaceURI === SVG_NS && el.localName !== 'svg' ? svgBox : shadow).appendChild(b);
        const cs = getComputedStyle(b), o = {};
        for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
        bases.set(key, o);
      }
      return bases.get(key);
    };
    const pseudo = []; let pid = 0;
    const sizesOf = sizeRules();
    const walk = (el, parentCs) => {
      if (el.nodeType === 3) return document.createTextNode(el.nodeValue);
      if (el.nodeType !== 1) return null;
      const tag = el.localName;
      if (/^(script|style|template|link)$/.test(tag)) return null;
      if (el.classList && (el.classList.contains('lg-snap-row') || el.classList.contains('lg-snap-view'))) return null;
      const cs = getComputedStyle(el), base = baseOf(el), isSvg = el.namespaceURI === SVG_NS;
      const c = el.cloneNode(false);
      c.removeAttribute('data-draw'); c.removeAttribute('hidden');
      let st = '';
      const free = !isSvg && !REPLACED.test(tag) && parentCs;
      const sized = free ? sizesOf(el) : null;
      const holdsText = free && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim());
      for (let i = 0; i < cs.length; i++) {
        const p = cs[i];
        if (p.startsWith('--') || SKIP.test(p) || (isSvg && tag !== 'svg' && SVG_GEO.has(p))) continue;
        if (free && LOGICAL.test(p)) continue;
        if (free && SIZE.has(p) && (p !== 'width' || holdsText)) {
          const sv = sized[p];
          if (/^grid-/.test(p) && !(sv && /fr|auto|min|max|fit/.test(sv))) { /* fixed tracks: keep as measured */ }
          else if (!sv || sv === 'auto' || sv === 'none') continue;
          else if (sv.indexOf('var(') < 0) { st += p + ':' + sv + ';'; continue; }
        }
        const v = cs.getPropertyValue(p);
        if (v !== base[p] || (parentCs && v !== parentCs.getPropertyValue(p))) st += p + ':' + fixUrl(v) + ';';
      }
      if (el.classList && el.classList.contains('ff-reveal')) st += 'opacity:1;filter:none;transform:none;';
      if (tag === 'svg' && isSvg) { const r = el.getBoundingClientRect(); st += 'width:' + r.width + 'px;height:' + r.height + 'px;'; }
      c.setAttribute('style', st);
      if (tag === 'input') { c.setAttribute('value', el.value); if (el.checked) c.setAttribute('checked', ''); }
      if (tag === 'option' && el.selected) c.setAttribute('selected', '');
      if (tag === 'details' && el.open) c.setAttribute('open', '');
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which), ct = ps.getPropertyValue('content');
        if (!ct || ct === 'none' || ct === 'normal') continue;
        const cls = 'snp' + (pid++);
        c.setAttribute('class', ((c.getAttribute('class') || '') + ' ' + cls).trim());
        let body = '';
        for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (!p.startsWith('--') && !SKIP.test(p)) body += p + ':' + fixUrl(ps.getPropertyValue(p)) + ';'; }
        pseudo.push('.' + cls + which + '{' + body + '}');
      }
      if (cs.display !== 'none') for (const ch of Array.from(el.childNodes)) { const k = walk(ch, cs); if (k) c.appendChild(k); }
      return c;
    };
    try { return {clone: walk(src, null), pseudo: pseudo.join('')}; } finally { host.remove(); }
  }

  // Where the page can be cut: between blocks, never through one. Measured once, used for any column count.
  function measureCuts(src, H) {
    const top0 = src.getBoundingClientRect().top;
    const atoms = [];
    const visit = (el, depth) => {
      for (const ch of Array.from(el.children)) {
        if (ch.classList.contains('lg-snap-row')) continue;
        const r = ch.getBoundingClientRect();
        if (!r.height) continue;
        const a = {t: r.top - top0, b: r.bottom - top0};
        if (r.height <= 520 || depth > 12 || ch.namespaceURI === SVG_NS || !ch.children.length) atoms.push(a);
        else visit(ch, depth + 1);
      }
    };
    visit(src, 0);
    const ok = (y) => !atoms.some((a) => a.t < y - 1 && a.b > y + 1);
    const cands = [...new Set(atoms.flatMap((a) => [a.t, a.b]).map((y) => Math.round(y)))].filter((y) => y > 0 && y < H && ok(y)).sort((x, y) => x - y);
    const tops = [...src.children].map((ch) => Math.round(ch.getBoundingClientRect().top - top0 - 6)).filter((y) => y > 0 && y < H);
    const kids = [...src.children].map((ch) => ch.getBoundingClientRect()).filter((r) => r.height).map((r) => ({t: r.top - top0, b: r.bottom - top0}));
    const snap = (y) => { for (let i = 0; i + 1 < kids.length; i++) { const lo = kids[i].b, hi = kids[i + 1].t; if (y >= lo - 48 && y <= hi + 48) return Math.round((lo + hi) / 2); } return y; };
    // Cut in the middle of the empty space between blocks, so a pixel of drift never shows a sliver.
    const mid = (y) => {
      const lo = Math.max(-Infinity, ...atoms.filter((a) => a.b <= y + 1).map((a) => a.b));
      const hi = Math.min(Infinity, ...atoms.filter((a) => a.t >= y - 1).map((a) => a.t));
      return isFinite(lo) && isFinite(hi) && hi >= lo && hi - lo < 80 ? Math.round((lo + hi) / 2) : y;
    };
    const cutsFor = (pageH) => {
      const cuts = [0];
      while (H - cuts[cuts.length - 1] > pageH) {
        const s = cuts[cuts.length - 1];
        const fit = cands.filter((y) => y >= s + pageH * 0.5 && y <= s + pageH);
        const big = tops.filter((y) => y >= s + pageH * 0.8 && y <= s + pageH);
        const y = big.length ? big[big.length - 1] : fit.length ? fit[fit.length - 1] : s + pageH;
        cuts.push(Math.max(s + 1, snap(mid(y))));
      }
      cuts.push(H);
      return cuts;
    };
    // The shortest column height that fits the page into n columns.
    return (n) => {
      let pageH = Math.ceil(H / n);
      let cuts = cutsFor(pageH);
      while (cuts.length - 1 > n) { pageH = Math.ceil(pageH * 1.03); cuts = cutsFor(pageH); }
      return cuts;
    };
  }

  const SRC_S = 2.5;   // detail the page is drawn at before it is laid out into columns
  const MAX_SIDE = 4096; // WhatsApp HD keeps up to about this on the long side

  async function snapshot(src, scratch) {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const prev = src.getAttribute('style') || '';
    const cur = src.getBoundingClientRect().width;
    const W = SHOT_W;
    const names = [...new Set([...src.querySelectorAll('[data-draw]')].map((x) => x.dataset.draw))].filter((x) => x !== 'lg-snap');
    const redraw = () => names.forEach((x) => { try { dash.draw(x); } catch (e) { /* not a drawing */ } });
    const resize = Math.abs(cur - W) > 1;
    // The picture can only use fonts it carries. If the page's own font can't be read here,
    // lay the page out in a system font for the moment, so text and boxes are measured alike.
    const fonts = await fontCss('FF Outfit');
    const sysFont = !fonts;
    if (sysFont) src.style.fontFamily = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    // Image mode: a neutral league view (no "you" lines or controls, folded tables open, the leader highlighted).
    const prevFocus = dash.params().lgfocus;
    const leaderRow = src.querySelector('[data-draw="lg-standings"] tbody tr');
    const leader = leaderRow && leaderRow.dataset.m;
    const opened = [...src.querySelectorAll('details')].filter((d) => !d.open);
    src.classList.add('lg-shot');
    opened.forEach((d) => { d.open = true; });
    if (leader) dash.setParams({lgfocus: leader});
    {
      src.style.width = W + 'px'; src.style.maxWidth = 'none'; src.style.minWidth = W + 'px'; src.style.marginInline = 'auto';
      await frame(); redraw(); await frame(); await wait(1000); await frame();
    }
    try {
      const through = ((src.querySelector('[data-draw="lg-through"]') || {}).textContent || '').trim();
      const {clone, pseudo} = cloneStyled(src, scratch);
      clone.style.margin = '0'; clone.style.width = W + 'px';
      // Measure the copy itself, so the cuts match exactly what gets drawn.
      const probe = document.createElement('div');
      probe.style.cssText = 'all:initial;display:block;position:fixed;left:-100000px;top:0;width:' + W + 'px;pointer-events:none;';
      const probeStyle = document.createElement('style'); probeStyle.textContent = pseudo;
      probe.append(probeStyle, clone); scratch.appendChild(probe);
      await frame(); await frame();
      const H = Math.ceil(clone.getBoundingClientRect().height);
      const columns = measureCuts(clone, H);
      probe.remove();
      const bg = bgOf(src);
      const wrap = document.createElement('div');
      wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrap.setAttribute('style', 'margin:0;padding:0;width:' + W + 'px;background:' + bg + ';');
      const style = document.createElement('style'); style.textContent = fonts + pseudo;
      wrap.append(style, clone);
      const svg = '<svg xmlns="' + SVG_NS + '" width="' + Math.round(W * SRC_S) + '" height="' + Math.round(H * SRC_S) + '" viewBox="0 0 ' + W + ' ' + H + '"><foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' + new XMLSerializer().serializeToString(wrap) + '</foreignObject></svg>';
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('render')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      // Settle the picture once before slicing it (some browsers draw an SVG late).
      const warm = document.createElement('canvas'); warm.width = 4; warm.height = 4; warm.getContext('2d').drawImage(img, 0, 0, 4, 4);
      return {img, W, H, bg, columns, through};
    } finally {
      if (prev) src.setAttribute('style', prev); else src.removeAttribute('style');
      src.classList.remove('lg-shot');
      opened.forEach((d) => { d.open = false; });
      if (leader) dash.setParams({lgfocus: prevFocus == null ? null : prevFocus});
      requestAnimationFrame(redraw);
    }
  }

  // Lays the page out as a poster: `perImage` columns side by side, across `count` images.
  async function compose(shot, count, perImage) {
    const {img, W, bg, through} = shot;
    const cuts = shot.columns(count * perImage);
    const cols = cuts.slice(0, -1).map((y, i) => [y, cuts[i + 1]]);
    const GAP = 28, M = 36, HEAD = 74, FOOTH = 30;
    const day = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
    const out = [];
    for (let k = 0; k < count; k++) {
      const mine = cols.slice(k * perImage, (k + 1) * perImage);
      if (!mine.length) break;
      const colH = Math.max(...mine.map(([a, b]) => b - a));
      const cw = M * 2 + perImage * W + (perImage - 1) * GAP;
      const ch = M + HEAD + colH + FOOTH + M * 0.6;
      const s = Math.min(SRC_S, MAX_SIDE / Math.max(cw, ch));
      const cv = document.createElement('canvas');
      cv.width = Math.round(cw * s); cv.height = Math.round(ch * s);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingQuality = 'high';
      // Header
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = '#f6e7bf'; ctx.font = '600 ' + Math.round(34 * s) + 'px "FF Outfit", system-ui, sans-serif';
      ctx.fillText('DutchNFL League', M * s, (M + 36) * s);
      ctx.fillStyle = 'rgba(230,231,233,.75)'; ctx.font = '500 ' + Math.round(15 * s) + 'px "FF Outfit", system-ui, sans-serif';
      ctx.fillText('Standings, prize race and Guillotine' + (through ? ' · ' + through : '') + ' · ' + day, M * s, (M + 60) * s);
      if (count > 1) { ctx.textAlign = 'right'; ctx.fillStyle = '#d3bc8d'; ctx.font = '600 ' + Math.round(20 * s) + 'px "FF Outfit", system-ui, sans-serif'; ctx.fillText('Part ' + (k + 1) + ' of ' + count, (cw - M) * s, (M + 36) * s); }
      ctx.strokeStyle = 'rgba(211,188,141,.45)'; ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.beginPath(); ctx.moveTo(M * s, (M + HEAD - 4) * s); ctx.lineTo((cw - M) * s, (M + HEAD - 4) * s); ctx.stroke();
      // Columns
      mine.forEach(([y0, y1], i) => {
        const x = M + i * (W + GAP), h = y1 - y0;
        ctx.drawImage(img, 0, y0 * SRC_S, W * SRC_S, h * SRC_S, x * s, (M + HEAD) * s, W * s, h * s);
        if (i) { ctx.strokeStyle = 'rgba(211,188,141,.18)'; ctx.beginPath(); ctx.moveTo((x - GAP / 2) * s, (M + HEAD + 8) * s); ctx.lineTo((x - GAP / 2) * s, (M + HEAD + colH - 8) * s); ctx.stroke(); }
      });
      // Footer
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(230,231,233,.5)'; ctx.font = '500 ' + Math.round(12 * s) + 'px "FF Outfit", system-ui, sans-serif';
      ctx.fillText('From the DutchNFL dashboard', (cw - M) * s, (M + HEAD + colH + FOOTH - 6) * s);
      out.push(await new Promise((res, rej) => { try { cv.toBlob((b) => b ? res(b) : rej(new Error('blob')), 'image/png'); } catch (e) { rej(e); } }));
    }
    return out;
  }

  const stamp = () => { const d = new Date(), z = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };

  dash.draw('lg-snap', {
    mount(el) {
      el.textContent = '';
      let busy = false, urls = [];
      const btn = (cls, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b; };
      const setBusy = (on) => document.querySelectorAll('.lg-snap-btn').forEach((b) => {
        b.disabled = on;
        b.querySelectorAll('.lg-snap-idle').forEach((x) => { x.hidden = on; });
        b.querySelectorAll('.lg-snap-busy').forEach((x) => { x.hidden = !on; });
      });
      const shell = (text) => {
        el.querySelectorAll('.lg-snap-view').forEach((v) => v.remove());
        urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
        const view = document.createElement('div'); view.className = 'lg-snap-view'; view.setAttribute('role', 'dialog'); view.setAttribute('aria-label', 'League images');
        const card = document.createElement('div'); card.className = 'lg-snap-card';
        const p = document.createElement('p'); p.textContent = text;
        const acts = document.createElement('div'); acts.className = 'lg-snap-acts';
        const x = btn('ff-theme', 'Close');
        const close = () => { view.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; };
        x.addEventListener('click', close);
        view.addEventListener('click', (e) => { if (e.target === view) close(); });
        acts.appendChild(x); card.append(p, acts); view.appendChild(card); el.appendChild(view);
        return {card, acts, x, p};
      };
      const getDl = async () => { try { return window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null; } catch (e) { return null; } };
      const LAYOUTS = [{key: 'one', label: '1 image', count: 1, per: 3}, {key: 'two', label: '2 images', count: 2, per: 2}];
      const show = async (shot) => {
        const ui = shell('Pick one big image or two, then save. Text stays sharp when you zoom in.');
        const dl = await getDl();
        const tip = document.createElement('p'); tip.className = 'lg-snap-tip';
        tip.textContent = 'For the sharpest result, send it in WhatsApp as a Document (paperclip, then Document) so it is not compressed. Sending it as a photo? Tap HD first.' + (dl ? '' : ' You can also right-click an image and choose "Save image as", or press and hold it on a phone.');
        const seg = document.createElement('div'); seg.className = 'lg-snap-seg';
        const grid = document.createElement('div'); grid.className = 'lg-snap-grid';
        const cache = {};
        let cur = null, gen = 0;
        const saveOne = async (blob, name, b) => {
          if (dl) {
            try { await dl.save({filename: name, data: blob}); if (b) { b.textContent = 'Saved'; b.disabled = true; } return true; }
            catch (e) { if (e && e.code === 'declined') return false; if (e && e.code === 'rate_limited') { await wait(1500); return saveOne(blob, name, b); } }
          }
          const u = URL.createObjectURL(blob); urls.push(u);
          const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
          return true;
        };
        const all = btn('ff-theme lg-snap-dl', 'Save');
        ui.acts.insertBefore(all, ui.x);
        const pick = async (L) => {
          const my = ++gen;
          seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === L.key)));
          all.disabled = true; all.textContent = 'Making…';
          if (!cache[L.key]) cache[L.key] = await compose(shot, L.count, L.per);
          if (my !== gen) return;
          const blobs = cache[L.key], n = blobs.length;
          const names = blobs.map((b, i) => 'DutchNFL-League-' + stamp() + (n > 1 ? '-part' + (i + 1) : '') + '.png');
          cur = {blobs, names};
          grid.className = 'lg-snap-grid n' + n;
          grid.replaceChildren(...blobs.map((b, i) => {
            const u = URL.createObjectURL(b); urls.push(u);
            const fig = document.createElement('figure'); fig.className = 'lg-snap-fig';
            const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener';
            const im = document.createElement('img'); im.src = u; im.alt = 'League image ' + (i + 1) + ' of ' + n;
            a.appendChild(im);
            const cap = document.createElement('figcaption');
            const lab = document.createElement('span'); lab.textContent = (n > 1 ? 'Part ' + (i + 1) + ' of ' + n + ' · ' : '') + Math.round(b.size / 1024) + ' KB';
            const one = btn('ff-theme lg-snap-dl', 'Save'); one.addEventListener('click', () => saveOne(b, names[i], one));
            cap.append(lab, one); fig.append(a, cap); return fig;
          }));
          all.disabled = false; all.textContent = n > 1 ? 'Save both' : 'Save image';
        };
        all.addEventListener('click', async () => {
          if (!cur) return; all.disabled = true;
          const figs = grid.querySelectorAll('.lg-snap-fig .lg-snap-dl');
          for (let i = 0; i < cur.blobs.length; i++) { const okd = await saveOne(cur.blobs[i], cur.names[i], figs[i]); if (!okd) break; await wait(dl ? 200 : 400); }
          all.disabled = false;
        });
        LAYOUTS.forEach((L) => { const b = btn('ff-theme', L.label); b.dataset.k = L.key; b.addEventListener('click', () => pick(L)); seg.appendChild(b); });
        ui.card.insertBefore(seg, ui.acts);
        ui.card.append(tip, grid);
        await pick(LAYOUTS[0]);
      };
      const onClick = async () => {
        if (busy) return; busy = true; setBusy(true);
        const wait1 = shell('Making the League image…');
        wait1.acts.hidden = true;
        let shot;
        try { shot = await snapshot(document.getElementById('league'), el); await show(shot); }
        catch (e) { console.error('League image', e); shell('This browser blocked the image. Try it in Chrome or the Claude desktop app.'); }
        busy = false; setBusy(false);
      };
      document.querySelectorAll('.lg-snap-btn').forEach((b) => b.addEventListener('click', onClick));
      return {onClick};
    },
    update() {},
    unmount(el, made) { if (made) document.querySelectorAll('.lg-snap-btn').forEach((b) => b.removeEventListener('click', made.onClick)); },
  });
})();
