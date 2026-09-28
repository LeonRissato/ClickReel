// Executa a lista de passos num Chromium controlado pelo Playwright e captura
// os quadros da tela (CDP screencast) + uma linha do tempo com cursor, cliques,
// passos, URLs e trechos de carregamento. O renderizador usa isso depois.
const fs = require('fs');
const path = require('path');
const { comPadrao, viewportDe, VELOCIDADES, passoValeNoFormato, abrirNavegador, nitidezCaptura } = require('./config');
const { localizar: localizarBase, achar, Cancelado, esperarPaginaLivre, paginaOcupada, avisoDeErro } = require('./alvos');
const { deveBorrar, segredosDo, separarEsconder, scriptPagina } = require('./borrar');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

class ErroPasso extends Error {
  constructor(msg, indice) {
    super(msg);
    this.indice = indice;
  }
}

// ---------- Gravação ----------
async function gravar({ roteiro, jobDir, teste = false, previa = false, narracoes = [], aoProgredir = () => {}, aoEsperar = () => {}, cancelado = () => false, pausado = () => false }) {
  // tempo mínimo de cada passo para a narração caber
  const falaDoPasso = Object.fromEntries((narracoes || []).map((n) => [n.indice, n.duracao]));
  // procura o alvo mostrando a espera no painel e obedecendo Parar/Pausar
  const localizar = (page, alvo, timeout = 15000) =>
    localizarBase(page, alvo, timeout, { cancelado, pausado, aoEsperar: (s, t) => aoEsperar(`procurando "${alvo}"… ${s}s de ${t}s`) });
  const config = comPadrao(roteiro.config);
  const vel = teste ? 0.5 : VELOCIDADES[config.velocidade] || 1;
  const vp = viewportDe(config);
  const dsf = teste || previa ? 1 : nitidezCaptura(config);
  // índice original de cada passo (para o painel marcar o passo certo quando algo falha)
  const passos = (roteiro.passos || [])
    .map((p, i) => ({ ...p, _i: i }))
    .filter((p) => p && p.acao && passoValeNoFormato(p, config.formato));
  if (!passos.length) throw new Error('O roteiro não tem passos para este formato.');

  const pastaQuadros = path.join(jobDir, 'quadros');
  if (!teste) fs.mkdirSync(pastaQuadros, { recursive: true });

  const { browser, context, pagina } = await abrirNavegador(config, { headless: teste ? false : !config.mostrarNavegador, dsf });
  // borrão de dados sensíveis aplicado na própria página (antes da captura)
  const esconder = separarEsconder(config);
  await context.addInitScript({ content: scriptPagina(segredosDo(passos), esconder.css) });
  let page = await pagina();
  const borrarEl = (el) => el.evaluate((e) => e.setAttribute('data-clickreel-borrar', '')).catch(() => {});
  async function aplicarEsconder() {
    for (const alvo of esconder.textos) {
      const el = await achar(page, alvo).catch(() => null);
      if (el) await borrarEl(el);
    }
  }

  const T0 = Date.now();
  const agora = () => (Date.now() - T0) / 1000;
  const linha = {
    versao: 1,
    formato: config.formato,
    viewport: vp,
    dsf,
    inicio: 0,
    fim: 0,
    quadros: [],
    cursor: [],
    cliques: [],
    passos: [],
    urls: [],
    carregando: []
  };

  // Cada aba nova (ex.: link do e-mail que abre em outra aba) passa a ser a gravada.
  let navegacaoIniciada = 0;
  let ultimaNavPedida = -1; // instante (s) do último pedido de troca de página
  let cdp = null;
  let nQuadro = 0;
  async function ligarPagina(p) {
    if (cdp) { await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}); cdp = null; }
    page = p;
    // URL atual (para a barra de endereço da moldura)
    p.on('framenavigated', (f) => {
      if (p === page && f === p.mainFrame()) linha.urls.push({ t: agora(), url: f.url() });
    });
    // Detecta início de navegação (clique que troca de página)
    p.on('request', (req) => {
      try { if (p === page && req.isNavigationRequest() && req.frame() === p.mainFrame()) { navegacaoIniciada++; ultimaNavPedida = agora(); } } catch (_) {}
    });
    if (teste) return;
    const sessao = await context.newCDPSession(p);
    cdp = sessao;
    sessao.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      sessao.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (sessao !== cdp) return;
      let ms = metadata && metadata.timestamp ? metadata.timestamp * 1000 : Date.now();
      if (Math.abs(ms - Date.now()) > 3000) ms = Date.now();
      const nome = String(++nQuadro).padStart(6, '0') + '.jpg';
      fs.writeFileSync(path.join(pastaQuadros, nome), Buffer.from(data, 'base64'));
      linha.quadros.push({ t: (ms - T0) / 1000, f: nome });
    });
    await sessao.send('Page.startScreencast', {
      format: 'jpeg',
      quality: previa ? 75 : config.qualidade === 'maxima' ? 97 : 90,
      maxWidth: Math.round(vp.width * dsf),
      maxHeight: Math.round(vp.height * dsf),
      everyNthFrame: 1
    });
  }
  let trocandoAba = Promise.resolve();
  context.on('page', (nova) => {
    trocandoAba = trocandoAba.then(async () => {
      const t0 = agora();
      navegacaoIniciada++;
      await ligarPagina(nova);
      await nova.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
      await nova.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      linha.urls.push({ t: agora(), url: nova.url() });
      if (agora() - t0 > 1.2) linha.carregando.push({ t0: t0 + 0.4, t1: agora() });
    }).catch(() => {});
  });
  await ligarPagina(page);

  // ---- cursor ----
  const cur = { x: vp.width * 0.62, y: vp.height * 0.7 };
  linha.cursor.push({ t: 0, x: cur.x, y: cur.y });

  async function moverCursor(dest) {
    const dx = dest.x - cur.x;
    const dy = dest.y - cur.y;
    const dist = Math.hypot(dx, dy);
    const dur = Math.min(1100, 380 + dist * 0.55) * vel;
    const passosMov = Math.max(6, Math.round(dur / 16));
    const ini = { ...cur };
    // curva suave: desvio perpendicular leve, como uma mão real
    const nx = dist ? -dy / dist : 0;
    const ny = dist ? dx / dist : 0;
    const curva = Math.min(60, dist * 0.08);
    const t0 = Date.now();
    for (let i = 1; i <= passosMov; i++) {
      const p = easeInOut(i / passosMov);
      const arco = Math.sin(Math.PI * p) * curva;
      const x = ini.x + dx * p + nx * arco;
      const y = ini.y + dy * p + ny * arco;
      await page.mouse.move(x, y);
      cur.x = x;
      cur.y = y;
      linha.cursor.push({ t: agora(), x, y });
      const espera = t0 + (dur * i) / passosMov - Date.now();
      if (espera > 0) await sleep(espera);
    }
    cur.x = dest.x;
    cur.y = dest.y;
  }

  // ---- rolagem suave da janela ----
  async function rolarPor(dy) {
    if (!dy) return;
    const dur = Math.min(1400, 450 + Math.abs(dy) * 0.6) * vel;
    await page.evaluate(
      async ({ dy, dur }) => {
        const y0 = window.scrollY;
        const t0 = performance.now();
        await new Promise((res) => {
          function f(now) {
            const p = Math.min(1, (now - t0) / dur);
            const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            window.scrollTo({ top: y0 + dy * e, behavior: 'instant' });
            if (p < 1) requestAnimationFrame(f);
            else res();
          }
          requestAnimationFrame(f);
        });
      },
      { dy, dur }
    );
    await sleep(120);
  }

  async function mostrarElemento(el) {
    let box = await el.boundingBox();
    if (!box) return;
    const margem = config.formato === 'horizontal' ? 70 : 90;
    if (box.y >= margem && box.y + box.height <= vp.height - margem) return;
    const dy = box.y + box.height / 2 - vp.height * 0.5;
    await rolarPor(dy);
    box = await el.boundingBox();
    if (box && (box.y < 0 || box.y + box.height > vp.height)) {
      // elemento dentro de uma área com rolagem própria
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
    }
  }

  // ---- a página "assentou"? (sem "carregando" na tela e sem troca de página pendente) ----
  // Ex.: WooCommerce + Mercado Pago: "Finalizar pedido" envia por AJAX, a tela fica coberta
  // por "carregando" vários segundos e só depois o script leva para a página do pedido.
  function navPendente() {
    if (ultimaNavPedida < 0) return false;
    const ult = linha.urls[linha.urls.length - 1];
    return (!ult || ult.t < ultimaNavPedida) && agora() - ultimaNavPedida < 60;
  }
  async function esperarAssentar(limiteS = 90, gracaMs = 1500) {
    const fim = Date.now() + limiteS * 1000;
    let livreDesde = 0;
    let viuOcupada = false;
    while (Date.now() < fim && !cancelado()) {
      await trocandoAba;
      const ocupada = navPendente() || (await paginaOcupada(page));
      if (ocupada) {
        livreDesde = 0;
        viuOcupada = true;
        if (navPendente()) await page.waitForLoadState('load', { timeout: 1500 }).catch(() => {});
        else await sleep(250);
        continue;
      }
      if (!livreDesde) livreDesde = Date.now();
      // um instante a mais: o redirecionamento por script costuma vir logo depois do "carregando" sumir
      if (!viuOcupada || Date.now() - livreDesde >= gracaMs) return true;
      await sleep(150);
    }
    return cancelado();
  }

  // ---- espera depois de uma ação que pode trocar de página ----
  async function esperarPagina(navAntes, avisoAntes = '') {
    const t0 = agora();
    await sleep(400);
    await trocandoAba;
    if (navegacaoIniciada === navAntes && !(await paginaOcupada(page))) {
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
    const navAntesAssentar = navegacaoIniciada;
    const assentou = await esperarAssentar(90, navegacaoIniciada > navAntes ? 300 : 1500);
    if (navegacaoIniciada > navAntes) {
      await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      // redirecionamento feito depois do "carregando": espera ele também assentar
      if (navegacaoIniciada > navAntesAssentar) await esperarAssentar(60, 300);
    }
    const t1 = agora();
    if (t1 - t0 > 1.2) linha.carregando.push({ t0: t0 + 0.6, t1 });
    const aviso = await avisoDeErro(page);
    if (aviso && aviso !== avisoAntes) {
      throw new Error(`Depois do clique o site mostrou um erro: "${aviso}". Confira os dados preenchidos nos passos anteriores.`);
    }
    if (!assentou) {
      throw new Error('A página ficou "carregando" por mais de 90 segundos depois do clique e não saiu disso. ' +
        'O site pode ter recusado o pedido ou bloqueado o navegador automático — marque "Mostrar o navegador enquanto grava" para ver o que acontece.');
    }
  }

  // alvo → leva o cursor até ele; devolve a caixa do elemento
  async function irAte(passo) {
    const t0 = agora();
    if (!(await esperarPaginaLivre(page))) aoEsperar('a página continua "carregando"; tentando assim mesmo');
    if (agora() - t0 > 1.2) linha.carregando.push({ t0: t0 + 0.3, t1: agora() });
    const el = await localizar(page, passo.alvo);
    await mostrarElemento(el);
    await sleep(150 * vel);
    const box = await el.boundingBox();
    if (!box) throw new Error(`O elemento "${passo.alvo}" não está visível.`);
    const inicioFoco = agora();
    await moverCursor({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    return { el, box, inicioFoco };
  }

  async function clicarAqui() {
    await sleep(110 * vel);
    linha.cliques.push({ t: agora(), x: cur.x, y: cur.y });
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
  }

  let inicioDefinido = false;
  const marcarInicio = async () => {
    if (inicioDefinido) return;
    inicioDefinido = true;
    await sleep(500);
    linha.inicio = agora();
  };

  try {
    for (let i = 0; i < passos.length; i++) {
      if (cancelado()) throw Object.assign(new ErroPasso('Parado por você.', passo_i_seguro(passos, i)), { cancelado: true });
      // pausa entre passos (o navegador fica parado na tela atual)
      if (pausado()) {
        aoProgredir({ passo: i + 1, total: passos.length, indice: passos[i]._i, texto: 'pausado — clique em Continuar', pausado: true });
        while (pausado() && !cancelado()) await sleep(200);
        if (cancelado()) throw Object.assign(new ErroPasso('Parado por você.', passo_i_seguro(passos, i)), { cancelado: true });
      }
      const passo = passos[i];
      aoProgredir({ passo: i + 1, total: passos.length, indice: passo._i, texto: descrever(passo) });
      if (i > 0) await aplicarEsconder();
      const reg = {
        i,
        acao: passo.acao,
        t0: agora(),
        t1: 0,
        legenda: passo.legenda || '',
        zoom: passo.zoom !== false,
        foco: null,
        inicioFoco: 0,
        fimFoco: 0
      };
      try {
        switch (passo.acao) {
          case 'abrir': {
            let url = (passo.url || '').trim();
            if (!url) throw new Error('Informe o endereço da página.');
            if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
            const t0 = agora();
            await page.goto(url, { waitUntil: 'load', timeout: 60000 });
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            if (inicioDefinido && agora() - t0 > 1.2) linha.carregando.push({ t0: t0 + 0.4, t1: agora() });
            await marcarInicio();
            reg.t0 = Math.max(reg.t0, linha.inicio);
            break;
          }
          case 'clicar': {
            const { box, inicioFoco } = await irAte(passo);
            const navAntes = navegacaoIniciada;
            const avisoAntes = await avisoDeErro(page);
            await clicarAqui();
            Object.assign(reg, { foco: box, inicioFoco, fimFoco: agora() + 0.5 });
            await esperarPagina(navAntes, avisoAntes);
            break;
          }
          case 'digitar': {
            const { el, box, inicioFoco } = await irAte(passo);
            if (deveBorrar(passo)) await borrarEl(el);
            await clicarAqui();
            await sleep(200 * vel);
            if (passo.limpar !== false) {
              await el.fill('').catch(() => {});
            }
            await page.keyboard.type(String(passo.texto || ''), { delay: Math.round(70 * vel) });
            await sleep(250 * vel);
            Object.assign(reg, { foco: box, inicioFoco, fimFoco: agora() });
            break;
          }
          case 'selecionar': {
            const { el, box, inicioFoco } = await irAte(passo);
            if (deveBorrar(passo)) await borrarEl(el);
            linha.cliques.push({ t: agora(), x: cur.x, y: cur.y });
            const valor = String(passo.texto || '');
            await el.selectOption({ label: valor }).catch(() => el.selectOption(valor));
            await sleep(400 * vel);
            Object.assign(reg, { foco: box, inicioFoco, fimFoco: agora() });
            break;
          }
          case 'passar': {
            const { box, inicioFoco } = await irAte(passo);
            await sleep(900 * vel);
            Object.assign(reg, { foco: box, inicioFoco, fimFoco: agora() });
            break;
          }
          case 'rolar': {
            if (passo.alvo && passo.alvo.trim()) {
              const el = await localizar(page, passo.alvo);
              const box = await el.boundingBox();
              if (box) await rolarPor(box.y + box.height / 2 - vp.height * 0.45);
            } else {
              const px = parseInt(passo.pixels, 10);
              await rolarPor(Number.isFinite(px) ? px : vp.height * 0.7);
            }
            break;
          }
          case 'tecla': {
            const navAntes = navegacaoIniciada;
            await page.keyboard.press(String(passo.tecla || 'Enter'));
            await esperarPagina(navAntes);
            break;
          }
          case 'destacar': {
            // escurece a tela e ilumina o elemento, com um balão de texto opcional
            const el = await localizar(page, passo.alvo);
            await mostrarElemento(el);
            await sleep(200 * vel);
            const box = await el.boundingBox();
            if (!box) throw new Error(`O elemento "${passo.alvo}" não está visível.`);
            const s = parseFloat(String(passo.segundos || '').replace(',', '.'));
            const dur = (Number.isFinite(s) && s > 0 ? s : 2.5) * 1000;
            const ini = agora();
            const fim = Date.now() + dur;
            while (Date.now() < fim && !cancelado()) await sleep(100);
            Object.assign(reg, {
              foco: box, inicioFoco: ini, fimFoco: agora(),
              destaque: { box, texto: String(passo.texto || ''), t0: ini, t1: agora() }
            });
            break;
          }
          case 'aguardar': {
            const t0 = agora();
            const lim = parseFloat(String(passo.segundos || '').replace(',', '.'));
            const limite = (Number.isFinite(lim) && lim > 0 ? lim : 20) * 1000;
            const rec = parseFloat(String(passo.recarregar || '').replace(',', '.'));
            if (Number.isFinite(rec) && rec > 0) {
              // ex.: caixa de e-mail — recarrega a página até a mensagem aparecer
              const fimEspera = Date.now() + limite;
              let el = null;
              while (!el) {
                el = await localizar(page, passo.alvo, Math.min(rec * 1000, Math.max(500, fimEspera - Date.now()))).catch((e) => { if (e instanceof Cancelado) throw e; return null; });
                if (el) break;
                if (Date.now() > fimEspera) throw new Error(`"${passo.alvo}" não apareceu em ${Math.round(limite / 1000)}s (recarregando a página).`);
                aoEsperar(`recarregando a página para ver se "${passo.alvo}" chegou…`);
                await page.reload({ waitUntil: 'load', timeout: 45000 }).catch(() => {});
              }
            } else {
              await localizar(page, passo.alvo, limite);
            }
            if (agora() - t0 > 1.2) linha.carregando.push({ t0: t0 + 0.4, t1: agora() });
            break;
          }
          case 'esperar':
          case 'legenda': {
            // se a página ainda está "carregando", espera terminar antes (esse trecho é encurtado no vídeo)
            const tc = agora();
            await esperarAssentar(60, 300);
            if (agora() - tc > 1.2) linha.carregando.push({ t0: tc + 0.4, t1: agora() });
            const s = parseFloat(String(passo.segundos || '').replace(',', '.'));
            const fimEspera = Date.now() + (Number.isFinite(s) ? s : passo.acao === 'legenda' ? 2.5 : 1.5) * 1000;
            while (Date.now() < fimEspera && !cancelado()) await sleep(Math.min(200, Math.max(0, fimEspera - Date.now())));
            break;
          }
          default:
            throw new Error(`Ação desconhecida: ${passo.acao}`);
        }
      } catch (e) {
        if (e instanceof ErroPasso) throw e;
        if (e instanceof Cancelado) throw Object.assign(new ErroPasso('Parado por você.', passo._i), { cancelado: true });
        throw new ErroPasso(e.message.split('\n')[0], passo._i);
      }
      if (i === 0 && !inicioDefinido) await marcarInicio();
      // se o passo tem narração, espera a fala terminar antes de seguir
      const fala = falaDoPasso[passo._i];
      if (fala) {
        const fimFala = Date.now() + Math.max(0, (Math.max(reg.t0, linha.inicio) + fala + 0.35 - agora()) * 1000);
        while (Date.now() < fimFala && !cancelado()) await sleep(100);
      }
      await sleep(550 * vel);
      await aplicarEsconder();
      reg.t1 = agora();
      linha.passos.push(reg);
    }
    // não termina o vídeo no meio de um "carregando"
    const tf = agora();
    await esperarAssentar(45, 300);
    if (agora() - tf > 1.2) linha.carregando.push({ t0: tf + 0.4, t1: agora() });
    await sleep(1800);
    linha.fim = agora();
  } catch (e) {
    try {
      await page.screenshot({ path: path.join(jobDir, 'erro.png') });
    } catch (_) {}
    await browser.close().catch(() => {});
    throw e;
  }

  await trocandoAba;
  if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
  await sleep(200);
  await browser.close();

  if (!teste) {
    linha.quadros.sort((a, b) => a.t - b.t);
    fs.writeFileSync(
      path.join(jobDir, 'linha-do-tempo.json'),
      JSON.stringify({ ...linha, roteiro: { nome: roteiro.nome, passos } })
    );
  }
  return linha;
}

function passo_i_seguro(passos, i) {
  return passos[i] ? passos[i]._i : i;
}

function descrever(p) {
  const n = {
    abrir: `Abrindo ${p.url || ''}`,
    clicar: `Clicando em "${p.alvo || ''}"`,
    digitar: `Digitando em "${p.alvo || ''}"`,
    selecionar: `Escolhendo "${p.texto || ''}"`,
    passar: `Passando o mouse em "${p.alvo || ''}"`,
    rolar: 'Rolando a página',
    tecla: `Apertando ${p.tecla || 'Enter'}`,
    aguardar: `Aguardando "${p.alvo || ''}"`,
    esperar: 'Pausa',
    destacar: `Destacando "${p.alvo || ''}"`,
    legenda: 'Mostrando legenda'
  };
  return n[p.acao] || p.acao;
}

module.exports = { gravar, ErroPasso };
