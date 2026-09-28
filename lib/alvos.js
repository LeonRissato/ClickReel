// Encontra elementos na página a partir do "alvo" escrito pelo usuário
// (texto do botão, rótulo do campo, css: ..., texto: ..., "Comprar [2]").
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localizadores(page, alvo) {
  const a = alvo.trim();
  if (/^css:/i.test(a)) return [page.locator(a.slice(4).trim())];
  if (/^texto:/i.test(a)) {
    const t = a.slice(6).trim();
    return [page.getByText(t, { exact: true }), page.getByText(t)];
  }
  const pareceCss = /^[#.\[]/.test(a) || /^[a-z][a-z0-9-]*[#.\[]/i.test(a) || /^[a-z]+\s*>\s*/i.test(a);
  if (pareceCss) return [page.locator(a)];
  return [
    page.getByRole('button', { name: a, exact: true }),
    page.getByRole('link', { name: a, exact: true }),
    page.getByLabel(a, { exact: true }),
    page.getByPlaceholder(a, { exact: true }),
    page.getByText(a, { exact: true }),
    page.getByRole('button', { name: a }),
    page.getByRole('link', { name: a }),
    page.getByLabel(a),
    page.getByPlaceholder(a),
    page.getByText(a)
  ];
}

function separarOrdem(alvoBruto) {
  let alvo = String(alvoBruto || '').trim();
  let ordem = 0;
  const m = alvo.match(/^(.*\S)\s*\[(\d+)\]$/);
  if (m) {
    alvo = m[1];
    ordem = Math.max(0, parseInt(m[2], 10) - 1);
  }
  return { alvo, ordem };
}

async function acharNoQuadro(quadro, alvo, ordem) {
  for (const c of localizadores(quadro, alvo)) {
    try {
      const n = await c.count();
      const visiveis = [];
      for (let i = 0; i < Math.min(n, 25); i++) {
        const el = c.nth(i);
        if (await el.isVisible()) visiveis.push(el);
        if (visiveis.length > ordem) return visiveis[ordem];
      }
    } catch (_) { /* seletor inválido ou página navegando: tenta o próximo */ }
  }
  return null;
}

// Uma tentativa: devolve o elemento ou null.
// Procura primeiro na página e depois dentro dos iframes (ex.: campos de cartão do gateway).
async function achar(page, alvoBruto) {
  const { alvo, ordem } = separarOrdem(alvoBruto);
  if (!alvo) return null;
  const principal = page.mainFrame ? page.mainFrame() : page;
  const el = await acharNoQuadro(principal, alvo, ordem);
  if (el || !page.frames) return el;
  for (const quadro of page.frames()) {
    if (quadro === principal || quadro.isDetached()) continue;
    const dentro = await acharNoQuadro(quadro, alvo, ordem).catch(() => null);
    if (dentro) return dentro;
  }
  return null;
}

class Cancelado extends Error {
  constructor() { super('Parado por você.'); this.cancelado = true; }
}

// opcoes: { cancelado(), pausado(), aoEsperar(segundos, total) }
async function localizar(page, alvoBruto, timeout = 15000, opcoes = {}) {
  if (!alvoBruto || !String(alvoBruto).trim()) throw new Error('Este passo precisa de um alvo (texto do botão, link ou campo).');
  const { cancelado = () => false, pausado = () => false, aoEsperar = null } = opcoes;
  const inicio = Date.now();
  let esperaPausada = 0;
  let ultimoAviso = 0;
  while (true) {
    if (cancelado()) throw new Cancelado();
    if (pausado()) { const t = Date.now(); await sleep(250); esperaPausada += Date.now() - t; continue; }
    const el = await achar(page, alvoBruto);
    if (el) return el;
    const passou = Date.now() - inicio - esperaPausada;
    if (passou > timeout) break;
    if (aoEsperar && passou > 1500 && Date.now() - ultimoAviso > 900) {
      ultimoAviso = Date.now();
      aoEsperar(Math.round(passou / 1000), Math.round(timeout / 1000));
    }
    await sleep(250);
  }
  throw new Error(`Não encontrei na página: "${alvoBruto}" (esperei ${Math.round(timeout / 1000)}s). Confira se o texto está igual ao do site, ou use "Apontar".`);
}

// Recebe sugestões de alvo geradas na página para o elemento marcado com
// data-estudio-alvo="<id>" e devolve a primeira que realmente encontra ESSE elemento.
async function escolherAlvo(page, sugestoes, id) {
  for (const s of sugestoes || []) {
    for (let k = 1; k <= 6; k++) {
      const cand = k === 1 ? s : `${s} [${k}]`;
      const el = await achar(page, cand).catch(() => null);
      if (!el) break;
      const ok = await el
        .evaluate((e, id) => {
          const m = document.querySelector(`[data-estudio-alvo~="${id}"]`);
          return !!m && (e === m || m.contains(e) || (e.contains(m) && e.tagName !== 'BODY' && e.tagName !== 'HTML'));
        }, id)
        .catch(() => false);
      if (ok) return cand;
    }
  }
  return null;
}

// Camadas de "carregando" que cobrem a página (ex.: WooCommerce recalculando o frete no checkout).
const SOBREPOSICOES = [
  '.blockUI.blockOverlay', '.blockUI.blockMsg', '.woocommerce .processing .blockOverlay',
  'form.checkout.processing', // WooCommerce enviando o pedido
  '.wc-block-components-checkout-place-order-button--loading', // checkout em blocos
  '.wc-block-components-checkout-place-order-button .wc-block-components-spinner'
].join(', ');

// É a página "carregando" (sobreposição de espera do WooCommerce e afins)?
async function paginaOcupada(page) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => {
    const r = e.getBoundingClientRect(); const st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.05;
  }), SOBREPOSICOES).catch(() => false);
}

// Mensagem de erro que o site mostrou (ex.: "Escolha uma forma de pagamento")
const AVISOS_ERRO = '.woocommerce-error, .woocommerce-NoticeGroup-checkout .woocommerce-error, .wc-block-components-notice-banner.is-error, .woocommerce-notices-wrapper .is-error';
async function avisoDeErro(page) {
  return page.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().height > 0);
    return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  }, AVISOS_ERRO).catch(() => '');
}
async function esperarPaginaLivre(page, limite = 15000) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    if (!(await paginaOcupada(page))) return true;
    await sleep(200);
  }
  return false;
}

// Clique rápido e resistente (usado ao refazer passos): normal → forçado → pela posição na tela
async function clicarElemento(page, el, alvo) {
  await esperarPaginaLivre(page);
  try { await el.click({ timeout: 4000 }); return; } catch (_) {}
  await esperarPaginaLivre(page);
  try { await el.click({ timeout: 3000, force: true }); return; } catch (_) {}
  const b = await el.boundingBox().catch(() => null);
  if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); return; }
  throw new Error(`Não consegui clicar em "${alvo}": ele está escondido ou algo na página ficou por cima (ex.: "carregando").`);
}

module.exports = { achar, localizar, escolherAlvo, Cancelado, esperarPaginaLivre, clicarElemento, paginaOcupada, avisoDeErro };
