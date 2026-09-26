// Código injetado no site durante "Apontar no site" e "Gravar navegando".
// Gera sugestões de alvo para o elemento clicado e avisa o Estúdio.
// (Roda dentro da página; por isso é exportado como texto.)
module.exports = String.raw`
(() => {
  if (window.__estudioInstalado) return;
  window.__estudioInstalado = true;
  const MODO = window.__estudioModo || 'apontar';
  let seq = 0;

  const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const semObrig = (s) => limpar(String(s || '').replace(/\*|\(opcional\)|obrigat[óo]rio/gi, ''));
  const primeiraLinha = (s) => (String(s || '').split('\n').map(limpar).filter(Boolean)[0] || '');

  function interativo(el) {
    if (!el || !el.closest) return el;
    return el.closest('a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[onclick]') || el;
  }
  function campoTexto(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return ['', 'text', 'email', 'tel', 'number', 'search', 'url', 'password', 'date'].includes((el.getAttribute('type') || '').toLowerCase());
  }
  function textoRotulo(el) {
    if (el.labels && el.labels.length) return el.labels[0].innerText;
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.innerText; }
    const l = el.closest && el.closest('label'); return l ? l.innerText : '';
  }
  function caminhoCss(el) {
    const partes = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      if (el.id && !/^\d/.test(el.id)) { partes.unshift('#' + CSS.escape(el.id)); return partes.join(' > '); }
      let parte = el.tagName.toLowerCase();
      const irmaos = el.parentElement ? [...el.parentElement.children].filter((x) => x.tagName === el.tagName) : [];
      if (irmaos.length > 1) parte += ':nth-of-type(' + (irmaos.indexOf(el) + 1) + ')';
      partes.unshift(parte);
      el = el.parentElement;
    }
    return 'body > ' + partes.join(' > ');
  }
  function sugestoes(el) {
    const c = [];
    const add = (s) => { s = limpar(s); if (s && s.length <= 70 && !c.includes(s)) c.push(s); };
    const tag = el.tagName.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) {
      const tipo = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset'].includes(tipo)) add(el.value);
      const r = textoRotulo(el); add(semObrig(primeiraLinha(r))); add(primeiraLinha(r));
      add(el.getAttribute('placeholder')); add(el.getAttribute('aria-label'));
    } else if (tag === 'label') {
      add(semObrig(primeiraLinha(el.innerText))); add(primeiraLinha(el.innerText));
    } else {
      add(primeiraLinha(el.innerText)); add(el.getAttribute('aria-label')); add(el.getAttribute('title'));
      const img = el.querySelector && el.querySelector('img[alt]'); if (img) add(img.alt);
    }
    if (el.id && !/^\d/.test(el.id)) c.push('#' + CSS.escape(el.id));
    if (el.getAttribute('name')) c.push('css: ' + tag + '[name="' + el.getAttribute('name') + '"]');
    c.push('css: ' + caminhoCss(el));
    return c;
  }
  // cada evento ganha uma marca própria (vários podem estar em análise ao mesmo tempo)
  function marcar(el) {
    const id = 'e' + Date.now() + '-' + (++seq);
    const atual = (el.getAttribute('data-estudio-alvo') || '').split(' ').filter(Boolean).slice(-4);
    atual.push(id);
    el.setAttribute('data-estudio-alvo', atual.join(' '));
    return id;
  }
  function dados(el) {
    return { id: marcar(el), sugestoes: sugestoes(el), tag: el.tagName.toLowerCase(), campoTexto: campoTexto(el), select: el.tagName === 'SELECT' };
  }

  // ---- faixa de aviso no topo ----
  function faixa() {
    if (!document.body || document.getElementById('__estudio_faixa')) return;
    const f = document.createElement('div');
    f.id = '__estudio_faixa';
    f.textContent = MODO === 'apontar'
      ? '🎯 Clique no elemento que o passo deve usar  ·  segure Ctrl para clicar normalmente'
      : '● Gravando seus passos  ·  navegue normalmente e feche esta janela quando terminar';
    f.style.cssText = 'position:fixed;z-index:2147483647;top:10px;left:50%;transform:translateX(-50%);background:#1e1628;color:#fff;font:600 14px/1.2 "Segoe UI",system-ui,sans-serif;padding:10px 18px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap;opacity:.95';
    if (MODO !== 'apontar') f.style.background = '#c21d30';
    document.body.appendChild(f);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', faixa); else faixa();

  // ---------------- modo APONTAR ----------------
  if (MODO === 'apontar') {
    const caixa = document.createElement('div');
    caixa.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #ff4d5e;background:rgba(255,77,94,.12);border-radius:6px;transition:all .06s;display:none';
    const poeCaixa = () => { if (document.body && !caixa.isConnected) document.body.appendChild(caixa); };
    document.addEventListener('mousemove', (e) => {
      poeCaixa();
      if (e.ctrlKey) { caixa.style.display = 'none'; return; }
      const el = interativo(e.target);
      if (!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      Object.assign(caixa.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' });
    }, true);
    const bloquear = (e) => { if (!e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); } };
    ['mousedown', 'pointerdown', 'mouseup', 'pointerup'].forEach((t) => document.addEventListener(t, bloquear, true));
    document.addEventListener('click', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const el = interativo(e.target);
      caixa.style.borderColor = '#1f8a4c'; caixa.style.background = 'rgba(31,138,76,.18)';
      window.estudioApontado(dados(el));
    }, true);
    return;
  }

  // ---------------- modo GRAVAR NAVEGANDO ----------------
  let ultimoRotulo = 0;
  const repassando = () => !!window.__estudioRepassar;
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || repassando()) return;
    const el = interativo(e.target);
    if (!el || campoTexto(el) || el.tagName === 'SELECT' || el.tagName === 'OPTION') return;
    const tipo = (el.type || '').toLowerCase();
    if ((tipo === 'radio' || tipo === 'checkbox') && Date.now() - ultimoRotulo < 200) return; // clique gerado pelo <label>
    if (el.tagName === 'LABEL') ultimoRotulo = Date.now();
    const link = el.closest('a[href]');
    const href = link ? (link.getAttribute('href') || '') : '';
    const navega = (link && href && !href.startsWith('#') && !/^javascript:/i.test(href)) ||
      (el.form && ((el.tagName === 'BUTTON' && el.type === 'submit') || (el.tagName === 'INPUT' && ['submit', 'image'].includes(tipo))));
    const d = dados(el);
    if (navega) { e.preventDefault(); e.stopImmediatePropagation(); }
    window.estudioRegistrar({ tipo: 'clicar', interceptado: !!navega, abreNovaAba: !!(link && link.target === '_blank'), ...d });
  }, true);
  document.addEventListener('change', (e) => {
    if (repassando()) return;
    const el = e.target;
    if (campoTexto(el)) window.estudioRegistrar({ tipo: 'digitar', valor: el.value, senha: el.type === 'password', ...dados(el) });
    else if (el.tagName === 'SELECT') {
      const op = el.options[el.selectedIndex];
      window.estudioRegistrar({ tipo: 'selecionar', valor: op ? limpar(op.text) : el.value, ...dados(el) });
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.isTrusted || repassando()) return;
    const el = e.target;
    if (!campoTexto(el) || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    e.preventDefault(); e.stopImmediatePropagation();
    window.estudioRegistrar({ tipo: 'enter', valor: el.value, senha: el.type === 'password', ...dados(el) });
  }, true);
})();
`;
