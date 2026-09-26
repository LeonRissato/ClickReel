// "Apontar no site": abre o site numa janela visível, executa rapidamente os
// passos anteriores (para chegar na página certa) e espera o usuário clicar no
// elemento. Devolve o alvo já conferido.
const SCRIPT = require('./script-pagina');
const { comPadrao, passoValeNoFormato, abrirNavegador } = require('./config');
const { localizar, escolherAlvo } = require('./alvos');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const semVisual = () => process.env.ESTUDIO_HEADLESS === '1';

class ErroPasso extends Error {
  constructor(msg, indice) { super(msg); this.indice = indice; }
}

async function esperarCarregar(page) {
  await sleep(300);
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
}

// Executa um passo sem animação (só para chegar ao estado certo da página)
async function executarRapido(page, p) {
  switch (p.acao) {
    case 'abrir': {
      let url = (p.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      break;
    }
    case 'clicar': { const el = await localizar(page, p.alvo); await el.click({ timeout: 10000 }); await esperarCarregar(page); break; }
    case 'digitar': { const el = await localizar(page, p.alvo); await el.fill(String(p.texto || '')); break; }
    case 'selecionar': {
      const el = await localizar(page, p.alvo); const v = String(p.texto || '');
      await el.selectOption({ label: v }).catch(() => el.selectOption(v)); break;
    }
    case 'passar': { const el = await localizar(page, p.alvo); await el.hover(); break; }
    case 'tecla': await page.keyboard.press(String(p.tecla || 'Enter')); await esperarCarregar(page); break;
    case 'aguardar': await localizar(page, p.alvo, 60000); break;
    case 'rolar': {
      if (p.alvo && p.alvo.trim()) { const el = await localizar(page, p.alvo); await el.scrollIntoViewIfNeeded(); }
      else await page.mouse.wheel(0, parseInt(p.pixels, 10) || 500);
      break;
    }
    default: break; // esperar/legenda: não precisa
  }
}

async function apontar({ roteiro, indice, aoMensagem = () => {}, cancelado = () => false, aoAbrir = null }) {
  const config = comPadrao(roteiro.config);
  const anteriores = (roteiro.passos || []).slice(0, indice)
    .map((p, i) => ({ ...p, _i: i }))
    .filter((p) => p.acao && passoValeNoFormato(p, config.formato));
  if (!anteriores.some((p) => p.acao === 'abrir')) {
    throw new Error('Antes deste passo precisa existir um passo "Abrir página" com o endereço do site.');
  }

  const { browser, context, pagina } = await abrirNavegador(config, { headless: semVisual() });
  let fechado = false;
  browser.on('disconnected', () => { fechado = true; });
  try {
    let resolver;
    const apontado = new Promise((r) => { resolver = r; });
    await context.exposeBinding('estudioApontado', (_fonte, d) => resolver(d));
    const page = await pagina();

    aoMensagem('Abrindo o site e refazendo os passos anteriores…');
    for (const p of anteriores) {
      if (cancelado() || fechado) throw new Error('Cancelado.');
      try { await executarRapido(page, p); }
      catch (e) { throw new ErroPasso(e.message.split('\n')[0], p._i); }
    }

    // liga o modo de apontar na página atual e nas próximas
    await context.addInitScript({ content: 'window.__estudioModo="apontar";' + SCRIPT });
    await page.evaluate('window.__estudioModo="apontar";' + SCRIPT);
    aoMensagem(`Na janela que abriu, clique no elemento do passo ${indice + 1}. (Segure Ctrl para clicar normalmente, por exemplo para abrir um menu.)`);
    if (aoAbrir) aoAbrir(page).catch(() => {});

    let d = null;
    while (!d) {
      if (cancelado() || fechado) throw new Error('Cancelado: a janela foi fechada antes de você apontar.');
      d = await Promise.race([apontado, sleep(300).then(() => null)]);
    }
    // a página que recebeu o clique pode ser outra (se o usuário navegou com Ctrl)
    const alvo = await escolherAlvo(page, d.sugestoes, d.id);
    await sleep(350);
    return {
      alvo: alvo || d.sugestoes[0],
      conferir: !alvo,
      campoTexto: d.campoTexto,
      select: d.select
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { apontar, executarRapido, ErroPasso };
