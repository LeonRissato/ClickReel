// "Gravar navegando": o usuário navega numa janela visível e cada clique,
// digitação e escolha vira um passo do roteiro (com o alvo já conferido).
const { chromium } = require('playwright');
const SCRIPT = require('./script-pagina');
const { comPadrao, criarContexto } = require('./config');
const { escolherAlvo } = require('./alvos');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capturar({ url, config: cfg, aoPasso = () => {}, parar = () => false, aoAbrir = null }) {
  const config = comPadrao(cfg);
  let endereco = String(url || '').trim();
  if (!endereco) throw new Error('Informe o endereço do site para começar.');
  if (!/^https?:\/\//i.test(endereco)) endereco = 'https://' + endereco;

  const passos = [{ acao: 'abrir', url: endereco, legenda: '' }];
  const browser = await chromium.launch({ headless: process.env.ESTUDIO_HEADLESS === '1' });
  let fechado = false;
  browser.on('disconnected', () => { fechado = true; });
  let ultimaAcao = Date.now();
  let iniciou = false;

  const avisar = () => aoPasso(passos.map((p) => ({ ...p })));
  const empurrar = (p) => {
    const ult = passos[passos.length - 1];
    // digitações seguidas no mesmo campo viram uma só
    if (p.acao === 'digitar' && ult && ult.acao === 'digitar' && ult.alvo === p.alvo) ult.texto = p.texto;
    else if (p.acao === 'selecionar' && ult && ult.acao === 'selecionar' && ult.alvo === p.alvo) ult.texto = p.texto;
    else passos.push({ legenda: '', ...p });
    ultimaAcao = Date.now();
    avisar();
  };

  // eventos chegam em ordem; processa um de cada vez
  let fila = Promise.resolve();
  const tratar = (page, ev) => {
    fila = fila.then(() => processar(page, ev)).catch(() => {});
    return fila;
  };

  async function repassar(page, fn) {
    await page.evaluate(() => { window.__estudioRepassar = true; }).catch(() => {});
    try { await fn(); } catch (_) {}
    await sleep(150);
    await page.evaluate(() => { window.__estudioRepassar = false; }).catch(() => {});
  }

  async function processar(page, ev) {
    ultimaAcao = Date.now();
    const alvo = await escolherAlvo(page, ev.sugestoes, ev.id).catch(() => null);
    const base = { alvo: alvo || ev.sugestoes[0] };
    if (!alvo) base.conferir = true;
    if (ev.tipo === 'clicar') {
      empurrar({ acao: 'clicar', ...base });
      if (ev.interceptado) {
        await repassar(page, () => page.locator(`[data-estudio-alvo~="${ev.id}"]`).first().click({ timeout: 5000 }));
      }
    } else if (ev.tipo === 'digitar') {
      empurrar({ acao: 'digitar', ...base, texto: ev.valor, ...(ev.senha ? { senha: true } : {}) });
    } else if (ev.tipo === 'selecionar') {
      empurrar({ acao: 'selecionar', ...base, texto: ev.valor });
    } else if (ev.tipo === 'enter') {
      const ult = passos[passos.length - 1];
      if (!(ult && ult.acao === 'digitar' && ult.alvo === base.alvo && ult.texto === ev.valor)) {
        empurrar({ acao: 'digitar', ...base, texto: ev.valor, ...(ev.senha ? { senha: true } : {}) });
      }
      empurrar({ acao: 'tecla', tecla: 'Enter' });
      await repassar(page, async () => {
        await page.locator(`[data-estudio-alvo~="${ev.id}"]`).first().focus({ timeout: 3000 });
        await page.keyboard.press('Enter');
      });
    }
    ultimaAcao = Date.now();
  }

  try {
    const context = await criarContexto(browser, config, 1);
    await context.exposeBinding('estudioRegistrar', ({ page }, ev) => { tratar(page, ev); });
    await context.addInitScript({ content: 'window.__estudioModo="gravar";' + SCRIPT });
    const page = await context.newPage();
    // endereço digitado na barra (navegação que não veio de um clique nosso)
    page.on('framenavigated', (f) => {
      if (!iniciou || f !== page.mainFrame()) return;
      if (Date.now() - ultimaAcao > 4000) { passos.push({ acao: 'abrir', url: f.url(), legenda: '' }); avisar(); }
    });
    await page.goto(endereco, { waitUntil: 'load', timeout: 60000 }).catch((e) => { throw new Error('Não consegui abrir o site: ' + e.message.split('\n')[0]); });
    iniciou = true;
    avisar();
    if (aoAbrir) aoAbrir(page).catch(() => {});
    while (!fechado && !parar()) await sleep(300);
    await fila.catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return passos;
}

module.exports = { capturar };
