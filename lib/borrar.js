// Borrão de dados sensíveis (CPF, cartão, e-mail...).
// O borrão é aplicado DENTRO da página, antes de a tela ser capturada:
// o dado nunca chega a ser gravado nos quadros do vídeo.

// Campos que já vêm marcados para borrar
const SENSIVEL = /\b(cpf|cnpj|rg|cart[aã]o|n[uú]mero do cart|cvv|cvc|c[oó]digo de seguran|senha|password|validade)\b/i;

function deveBorrar(passo) {
  if (!passo || !['digitar', 'selecionar'].includes(passo.acao)) return false;
  if (passo.borrar === true || passo.borrar === false) return passo.borrar;
  return SENSIVEL.test(String(passo.alvo || ''));
}

// Valores digitados em passos borrados: também são borrados onde aparecerem depois
function segredosDo(passos) {
  return passos
    .filter((p) => p.acao === 'digitar' && deveBorrar(p))
    .map((p) => String(p.texto || ''))
    .filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
}

function listaEsconder(config) {
  return String((config && config.esconder) || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Script que roda na página: estilo do borrão + varredura dos segredos
// Separa a lista "Esconder na tela": seletores CSS entram direto no estilo (sem atraso);
// textos/rótulos são procurados na página a cada passo.
function separarEsconder(config) {
  const css = [], textos = [];
  for (const l of listaEsconder(config)) {
    if (/^css:/i.test(l)) css.push(l.slice(4).trim());
    else if (/^[#.\[]/.test(l)) css.push(l);
    else textos.push(l);
  }
  return { css, textos };
}

function scriptPagina(segredos, seletores = []) {
  return `(() => {
  if (window.__clickreelBorrar) return; window.__clickreelBorrar = true;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^\\p{L}\\p{N}@]/gu, '');
  const SEG = ${JSON.stringify(segredos)}.map(norm).filter((s) => s.length >= 4);
  const SEL = ${JSON.stringify(seletores)}.filter((s) => { try { document.createDocumentFragment().querySelector(s); return true; } catch (_) { return false; } });
  const css = ['[data-clickreel-borrar]'].concat(SEL).join(',') + '{filter:blur(9px)!important;-webkit-text-security:disc;}';
  const poeEstilo = () => {
    const raiz = document.head || document.documentElement;
    if (!raiz || document.getElementById('__clickreel_borrar')) return;
    const st = document.createElement('style'); st.id = '__clickreel_borrar'; st.textContent = css;
    raiz.appendChild(st);
  };
  // o script roda antes de a página existir: tenta de novo assim que o <html> nascer
  if (!document.documentElement) {
    const obs = new MutationObserver(() => { if (document.documentElement) { poeEstilo(); obs.disconnect(); } });
    obs.observe(document, { childList: true });
  }
  poeEstilo();
  const marca = (el) => { if (el && el.setAttribute && !el.hasAttribute('data-clickreel-borrar')) el.setAttribute('data-clickreel-borrar', ''); };
  const contem = (t) => { const n = norm(t); return n && SEG.some((s) => n.includes(s)); };
  function varrer() {
    poeEstilo();
    if (!SEG.length || !document.body) return;
    for (const el of document.querySelectorAll('input, textarea')) if (el.value && contem(el.value)) marca(el);
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue && n.nodeValue.trim() && contem(n.nodeValue)) marca(n.parentElement);
  }
  let agendado = false;
  const agenda = () => { if (agendado) return; agendado = true; requestAnimationFrame(() => { agendado = false; varrer(); }); };
  document.addEventListener('DOMContentLoaded', () => {
    varrer();
    new MutationObserver(agenda).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  document.addEventListener('input', agenda, true);
  if (document.readyState !== 'loading') varrer();
})();`;
}

module.exports = { deveBorrar, segredosDo, listaEsconder, separarEsconder, scriptPagina, SENSIVEL };
