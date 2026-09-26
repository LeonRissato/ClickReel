// ClickReel — painel local para gravar vídeos de demonstração do site.
// Abra com "ABRIR-PAINEL.bat" (Windows) ou "node server.js".
// Na versão instalada (.exe) o Chromium vem dentro da pasta "navegadores".
{
  const embutido = require('path').join(__dirname, 'navegadores');
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && require('fs').existsSync(embutido)) process.env.PLAYWRIGHT_BROWSERS_PATH = embutido;
}
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { gravar } = require('./lib/gravador');
const { renderizar } = require('./lib/renderizador');
const { apontar } = require('./lib/apontador');
const { capturar } = require('./lib/captura');
const { comPadrao, FORMATOS, TRES_FORMATOS, passoValeNoFormato, abrirNavegador, slugPerfil } = require('./lib/config');
const { gerarNarracoes, VOZES_NEURAIS } = require('./lib/narracao');
const { caminhoFfmpeg } = require('./lib/renderizador');

const PORTA = Number(process.env.PORTA || 4580);
const RAIZ = __dirname;
const P = {
  publico: path.join(RAIZ, 'public'),
  demo: path.join(RAIZ, 'demo'),
  roteiros: path.join(RAIZ, 'roteiros'),
  videos: path.join(RAIZ, 'videos'),
  musicas: path.join(RAIZ, 'musicas'),
  jobs: path.join(RAIZ, '.gravacoes'),
  marca: path.join(RAIZ, 'marca'),
  perfis: path.join(RAIZ, '.perfis')
};
P.vozes = path.join(P.jobs, 'vozes');
process.env.CLICKREEL_PERFIS = P.perfis;
for (const d of [P.roteiros, P.videos, P.musicas, P.jobs, P.marca, P.perfis]) fs.mkdirSync(d, { recursive: true });

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.gif': 'image/gif', '.srt': 'application/x-subrip; charset=utf-8', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg'
};

// ---------------- estado (um trabalho por vez) ----------------
// ultimas: { formato: jobId } — última gravação de cada formato, usada pelo "Remontar"
let estado = {
  ocupado: false, fase: 'parado', mensagem: 'Pronto para gravar.', passo: 0, total: 0, indice: null, pct: 0,
  video: null, videoNome: null, videos: [], erro: null, erroImagem: null, erroIndice: null, formatoAtual: null,
  ultimas: {}, captura: null
};
let cancelar = false;
let pausar = false;
let pararCaptura = false;
const clientes = new Set();
function atualizar(mud) {
  estado = { ...estado, ...mud };
  const msg = `data: ${JSON.stringify(estado)}\n\n`;
  for (const c of clientes) c.write(msg);
}
const ARQ_ULTIMAS = path.join(P.jobs, 'ultimas.json');
try {
  const u = JSON.parse(fs.readFileSync(ARQ_ULTIMAS, 'utf8'));
  for (const [f, id] of Object.entries(u)) if (fs.existsSync(path.join(P.jobs, id, 'linha-do-tempo.json'))) estado.ultimas[f] = id;
} catch (_) {}

// ---------------- utilidades ----------------
const slug = (s) => (String(s || 'roteiro').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'roteiro').slice(0, 60);
const seguro = (nome) => path.basename(String(nome || ''));
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function lerCorpo(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { res(d ? JSON.parse(d) : {}); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}
function servirArquivo(req, res, arq) {
  fs.stat(arq, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Não encontrado'); }
    const tipo = TIPOS[path.extname(arq).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const ini = m && m[1] ? parseInt(m[1], 10) : 0;
      const fim = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': fim - ini + 1 });
      return fs.createReadStream(arq, { start: ini, end: fim }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(arq).pipe(res);
  });
}
function dentro(base, rel) {
  const alvo = path.normalize(path.join(base, rel));
  return alvo.startsWith(base) ? alvo : null;
}
function abrirNoSistema(alvo) {
  const cmd = process.platform === 'win32' ? `start "" "${alvo}"` : process.platform === 'darwin' ? `open "${alvo}"` : `xdg-open "${alvo}"`;
  exec(cmd, () => {});
}
function limparGravacoesAntigas(manter = 6) {
  try {
    const protegidas = new Set(Object.values(estado.ultimas));
    const pastas = fs.readdirSync(P.jobs).filter((d) => fs.statSync(path.join(P.jobs, d)).isDirectory()).sort().reverse();
    for (const d of pastas.slice(manter)) if (!protegidas.has(d) && d !== 'vozes') fs.rmSync(path.join(P.jobs, d), { recursive: true, force: true });
  } catch (_) {}
}
function nomeVideo(roteiro, formato) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${slug(roteiro.nome)}-${FORMATOS[formato].sufixo}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.mp4`;
}
const comFormato = (roteiro, formato) => ({ ...roteiro, config: { ...comPadrao(roteiro.config), formato } });

// ---------------- narração ----------------
function passosDoFormato(roteiro, formato) {
  return (roteiro.passos || []).map((p, i) => ({ ...p, _i: i })).filter((p) => p.acao && passoValeNoFormato(p, formato));
}
async function prepararNarracao(roteiro, formato, prefixo) {
  const config = comFormato(roteiro, formato).config;
  if (!config.narracaoAtiva) return [];
  return gerarNarracoes({
    passos: passosDoFormato(roteiro, formato), config,
    pastaCache: P.vozes, ffmpeg: caminhoFfmpeg(),
    aoProgredir: (m) => atualizar({ mensagem: prefixo + m })
  });
}
const arquivoLogo = () => ['png', 'jpg', 'webp', 'svg'].map((e) => path.join(P.marca, 'logo.' + e)).find((a) => fs.existsSync(a)) || null;

// ---------------- gravar / testar / prévia ----------------
async function gravarUmFormato(roteiro, formato, modo, prefixo) {
  const teste = modo === 'testar';
  const previa = modo === 'previa';
  const r = comFormato(roteiro, formato);
  const jobId = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + FORMATOS[formato].sufixo + '-' + slug(roteiro.nome).slice(0, 20);
  const jobDir = path.join(P.jobs, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const total = passosDoFormato(r, formato).length;
  atualizar({ fase: teste ? 'testando' : 'gravando', formatoAtual: formato, passo: 0, total, pct: 0, pausado: false, mensagem: `${prefixo}${teste ? 'Testando' : previa ? 'Prévia: percorrendo o caminho no site (em segundo plano)' : 'Preparando'}…` });
  // a narração é gerada antes: cada passo espera a fala terminar
  const narracoes = teste ? [] : await prepararNarracao(r, formato, prefixo);
  let textoPasso = '';
  try {
    await gravar({
      roteiro: r, jobDir, teste, previa, narracoes,
      cancelado: () => cancelar,
      pausado: () => pausar,
      aoProgredir: ({ passo, total, indice, texto }) => {
        textoPasso = `${prefixo}${previa ? 'Prévia · ' : ''}Passo ${passo} de ${total}: ${texto}`;
        atualizar({ passo, total, indice, mensagem: textoPasso });
      },
      aoEsperar: (txt) => atualizar({ mensagem: `${textoPasso} — ${txt}` })
    });
  } catch (e) {
    const temImg = fs.existsSync(path.join(jobDir, 'erro.png'));
    if (!temImg) fs.rmSync(jobDir, { recursive: true, force: true });
    e.erroImagem = temImg ? `/gravacoes/${jobId}/erro.png` : null;
    throw e;
  }
  if (teste) { fs.rmSync(jobDir, { recursive: true, force: true }); return null; }
  if (!previa) {
    estado.ultimas = { ...estado.ultimas, [formato]: jobId };
    fs.writeFileSync(ARQ_ULTIMAS, JSON.stringify(estado.ultimas));
    atualizar({ ultimas: estado.ultimas });
  }
  return renderizarJob(jobId, r, prefixo, { previa, narracoes });
}

async function renderizarJob(jobId, roteiro, prefixo = '', { previa = false, narracoes = null } = {}) {
  const lt = JSON.parse(fs.readFileSync(path.join(P.jobs, jobId, 'linha-do-tempo.json'), 'utf8'));
  const formato = lt.formato || 'horizontal';
  const nome = previa ? `previa-${slug(roteiro.nome)}-${FORMATOS[formato].sufixo}.mp4` : nomeVideo(roteiro, formato);
  // ao remontar, a narração é refeita com os textos atuais (vozes já geradas ficam no cache)
  if (!narracoes) narracoes = await prepararNarracao(roteiro, formato, prefixo);
  atualizar({ fase: 'renderizando', formatoAtual: formato, mensagem: `${prefixo}${previa ? 'Montando a prévia' : 'Montando o vídeo'}…`, pct: 0 });
  const r = await renderizar({
    jobDir: path.join(P.jobs, jobId), jobId,
    baseUrl: `http://127.0.0.1:${PORTA}`,
    config: comFormato(roteiro, formato).config,
    arquivoSaida: path.join(P.videos, nome),
    pastaMusicas: P.musicas,
    arquivoLogo: arquivoLogo(),
    narracoes, previa,
    cancelado: () => cancelar,
    aoProgredir: ({ pct, extra }) => atualizar({ pct, mensagem: `${prefixo}${extra || (previa ? 'Montando a prévia… ' : 'Montando o vídeo… ') + pct + '%'}` })
  });
  const url = (a) => `/videos/${encodeURIComponent(path.basename(a))}?v=${Date.now()}`;
  const extras = {};
  for (const [k, a] of Object.entries(r.extras || {})) extras[k] = url(a);
  return { nome, url: url(nome), formato: FORMATOS[formato].nome + (previa ? ' (prévia)' : ''), extras };
}

// Executa um roteiro (em 1 ou 3 formatos). Não mexe no estado final: devolve o resultado.
async function executarRoteiro(roteiro, modo, prefixoExtra = '') {
  const formatos = modo === 'todos' ? TRES_FORMATOS : [comPadrao(roteiro.config).formato];
  const feitos = [], falhas = [];
  for (const f of formatos) {
    const prefixo = prefixoExtra + (formatos.length > 1 ? `${FORMATOS[f].nome} · ` : '');
    try {
      const v = await gravarUmFormato(roteiro, f, modo === 'todos' ? 'gravar' : modo, prefixo);
      if (v) { feitos.push(v); atualizar({ videos: [...(estado.videos || []), v], video: v.url, videoNome: v.nome }); }
    } catch (e) {
      if (cancelar || e.cancelado) return { feitos, falhas, cancelado: e };
      falhas.push({ formato: (prefixoExtra ? roteiro.nome + ' · ' : '') + FORMATOS[f].nome, msg: (e.indice !== undefined ? `Passo ${e.indice + 1}: ` : '') + e.message, img: e.erroImagem, indice: e.indice });
    }
  }
  return { feitos, falhas };
}

function finalizar({ feitos, falhas, cancelado }, modo, rotuloFalha = (f) => f.formato) {
  pausar = false;
  limparGravacoesAntigas();
  if (cancelado) {
    return atualizar({
      ocupado: false, fase: 'parado', pausado: false, indice: null, erro: null, erroImagem: null,
      erroIndice: cancelado.indice ?? null,
      mensagem: `Parado por você${cancelado.indice !== undefined ? ` no passo ${cancelado.indice + 1}` : ''}.` + (feitos.length ? ` ${feitos.length} vídeo(s) ficaram prontos.` : '')
    });
  }
  if (falhas.length) {
    const f0 = falhas[0];
    return atualizar({
      ocupado: false, fase: 'erro', indice: null, pausado: false,
      mensagem: feitos.length ? `${feitos.length} vídeo(s) prontos, mas houve erro.` : 'Algo deu errado.',
      erro: falhas.map((f) => (falhas.length > 1 || feitos.length ? `[${rotuloFalha(f)}] ` : '') + f.msg).join('\n'),
      erroImagem: f0.img, erroIndice: f0.indice ?? null
    });
  }
  if (modo === 'testar') return atualizar({ ocupado: false, fase: 'testado', indice: null, pct: 100, mensagem: 'Teste concluído: todos os passos funcionaram. Pode gravar o vídeo.' });
  atualizar({ ocupado: false, fase: 'pronto', indice: null, pct: 100, mensagem: modo === 'previa' ? 'Prévia pronta!' : feitos.length > 1 ? `${feitos.length} vídeos prontos!` : 'Vídeo pronto!' });
}

function comecar() {
  cancelar = false;
  pausar = false;
  atualizar({ ocupado: true, erro: null, erroImagem: null, erroIndice: null, video: null, videos: [], indice: null, fila: null });
}

async function executar(roteiro, modo) {
  comecar();
  finalizar(await executarRoteiro(roteiro, modo), modo);
}

// Fila: vários roteiros, um depois do outro
async function executarFila(arquivos, modo) {
  comecar();
  const total = { feitos: [], falhas: [] };
  for (let k = 0; k < arquivos.length; k++) {
    let roteiro;
    try { roteiro = JSON.parse(fs.readFileSync(path.join(P.roteiros, seguro(arquivos[k])), 'utf8')); }
    catch (_) { total.falhas.push({ formato: arquivos[k], msg: 'roteiro não encontrado' }); continue; }
    atualizar({ fila: { atual: k + 1, total: arquivos.length, nome: roteiro.nome } });
    const r = await executarRoteiro(roteiro, modo, `Fila ${k + 1}/${arquivos.length} · ${roteiro.nome} · `);
    total.feitos.push(...r.feitos);
    total.falhas.push(...r.falhas.map((f) => ({ ...f, formato: `${roteiro.nome} · ${f.formato}` })));
    if (r.cancelado) { total.cancelado = r.cancelado; break; }
  }
  atualizar({ fila: null });
  finalizar(total, modo === 'todos' ? 'gravar' : modo);
}

// ---------------- aviso de atualização ----------------
const VERSAO = require('./package.json').version;
const REPO = 'LeonRissato/ClickReel';
let cacheAtualizacao = { quando: 0, dados: null };
const ARQ_PREFS = path.join(RAIZ, 'preferencias.json');
function lerPrefs() { try { return { checarAtualizacoes: true, ...JSON.parse(fs.readFileSync(ARQ_PREFS, 'utf8')) }; } catch (_) { return { checarAtualizacoes: true }; } }
function maisNova(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let k = 0; k < 3; k++) { if ((pa[k] || 0) > (pb[k] || 0)) return true; if ((pa[k] || 0) < (pb[k] || 0)) return false; }
  return false;
}
function buscarUltimaVersao() {
  return new Promise((res) => {
    const req = require('https').get(`https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'ClickReel', Accept: 'application/vnd.github+json' }, timeout: 8000 }, (r) => {
        let d = ''; r.on('data', (c) => (d += c));
        r.on('end', () => { try { const j = JSON.parse(d); res(j.tag_name ? { versao: j.tag_name.replace(/^v/, ''), url: j.html_url } : null); } catch (_) { res(null); } });
      });
    req.on('error', () => res(null));
    req.on('timeout', () => { req.destroy(); res(null); });
  });
}
async function verificarAtualizacao(forcar = false) {
  if (!lerPrefs().checarAtualizacoes && !forcar) return { atual: VERSAO, desligado: true };
  if (!forcar && cacheAtualizacao.dados && Date.now() - cacheAtualizacao.quando < 6 * 3600e3) return cacheAtualizacao.dados;
  const u = await buscarUltimaVersao();
  const dados = { atual: VERSAO, nova: u && maisNova(u.versao, VERSAO) ? u.versao : null, url: u ? u.url : `https://github.com/${REPO}/releases` };
  cacheAtualizacao = { quando: Date.now(), dados };
  return dados;
}

// ---------------- login lembrado (perfis) ----------------
function listarPerfis() {
  try { return fs.readdirSync(P.perfis).filter((d) => fs.statSync(path.join(P.perfis, d)).isDirectory()); } catch (_) { return []; }
}
async function entrarNoSite(perfil, url, config) {
  const { browser, pagina } = await abrirNavegador({ ...config, perfil }, { headless: process.env.ESTUDIO_HEADLESS === '1' });
  let fechado = false;
  browser.on('disconnected', () => { fechado = true; });
  const page = await pagina();
  let endereco = String(url || '').trim();
  if (endereco && !/^https?:\/\//i.test(endereco)) endereco = 'https://' + endereco;
  if (endereco) await page.goto(endereco, { timeout: 60000 }).catch(() => {});
  while (!fechado && !cancelar) await new Promise((r) => setTimeout(r, 400));
  await browser.close().catch(() => {});
}

// ---------------- rotas ----------------
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rota = decodeURIComponent(url.pathname);
  try {
    if (rota === '/api/estado') return json(res, 200, estado);
    if (rota === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(estado)}\n\n`);
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
      return;
    }
    if (rota === '/api/formatos') return json(res, 200, FORMATOS);
    if (rota === '/api/padrao') return json(res, 200, require('./lib/config').PADRAO);

    // roteiros
    if (rota === '/api/roteiros' && req.method === 'GET') {
      const lista = fs.readdirSync(P.roteiros).filter((f) => f.endsWith('.json')).map((f) => {
        try { const r = JSON.parse(fs.readFileSync(path.join(P.roteiros, f), 'utf8')); return { arquivo: f, nome: r.nome || f }; }
        catch (_) { return { arquivo: f, nome: f + ' (com erro)' }; }
      }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return json(res, 200, lista);
    }
    const mRot = rota.match(/^\/api\/roteiros\/([^/]+)$/);
    if (mRot) {
      const arq = path.join(P.roteiros, seguro(mRot[1]));
      if (req.method === 'GET') return fs.existsSync(arq) ? json(res, 200, JSON.parse(fs.readFileSync(arq, 'utf8'))) : json(res, 404, { erro: 'Roteiro não encontrado' });
      if (req.method === 'PUT') { const r = await lerCorpo(req); fs.writeFileSync(arq, JSON.stringify(r, null, 2)); return json(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { if (fs.existsSync(arq)) fs.unlinkSync(arq); return json(res, 200, { ok: true }); }
    }
    if (rota === '/api/novo-arquivo' && req.method === 'POST') {
      const { nome } = await lerCorpo(req);
      const base = slug(nome);
      let f = base + '.json', n = 2;
      while (fs.existsSync(path.join(P.roteiros, f))) f = `${base}-${n++}.json`;
      return json(res, 200, { arquivo: f });
    }
    if (rota === '/api/musicas') return json(res, 200, fs.readdirSync(P.musicas).filter((f) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f)));
    if (rota === '/api/videos') {
      const v = fs.readdirSync(P.videos).filter((f) => f.endsWith('.mp4'))
        .map((f) => ({ nome: f, url: `/videos/${encodeURIComponent(f)}`, data: fs.statSync(path.join(P.videos, f)).mtimeMs }))
        .sort((a, b) => b.data - a.data).slice(0, 15);
      return json(res, 200, v);
    }

    // gravar / testar / todos
    if (rota === '/api/executar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { roteiro, modo } = await lerCorpo(req);
      if (!roteiro || !Array.isArray(roteiro.passos) || !roteiro.passos.length) return json(res, 400, { erro: 'O roteiro está vazio.' });
      executar(roteiro, modo);
      return json(res, 200, { ok: true });
    }
    // remontar a última gravação do formato atual
    if (rota === '/api/renderizar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { roteiro, previa } = await lerCorpo(req);
      const formato = comPadrao(roteiro && roteiro.config).formato;
      const jobId = estado.ultimas[formato];
      if (!jobId) return json(res, 400, { erro: `Ainda não há gravação no formato ${FORMATOS[formato].nome}. Clique em "Gravar vídeo".` });
      comecar();
      renderizarJob(jobId, roteiro, '', { previa: !!previa })
        .then((v) => atualizar({ ocupado: false, fase: 'pronto', pct: 100, mensagem: previa ? 'Prévia pronta!' : 'Vídeo pronto!', video: v.url, videoNome: v.nome, videos: [v] }))
        .catch((e) => atualizar({ ocupado: false, fase: cancelar ? 'parado' : 'erro', erro: cancelar ? null : e.message, mensagem: cancelar ? 'Parado por você.' : 'Algo deu errado.' }));
      return json(res, 200, { ok: true });
    }

    // fila de gravação
    if (rota === '/api/fila' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { arquivos, modo } = await lerCorpo(req);
      if (!Array.isArray(arquivos) || !arquivos.length) return json(res, 400, { erro: 'Escolha pelo menos um roteiro.' });
      executarFila(arquivos, modo === 'todos' ? 'todos' : 'gravar');
      return json(res, 200, { ok: true });
    }

    // logo (marca d'água e cartões)
    if (rota === '/logo') { const a = arquivoLogo(); if (a) return servirArquivo(req, res, a); res.writeHead(404); return res.end(); }
    if (rota === '/api/logo' && req.method === 'GET') return json(res, 200, { tem: !!arquivoLogo() });
    if (rota === '/api/logo' && req.method === 'POST') {
      const { dataUrl } = await lerCorpo(req);
      const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return json(res, 400, { erro: 'Envie uma imagem PNG, JPG, WEBP ou SVG.' });
      for (const e of ['png', 'jpg', 'webp', 'svg']) fs.rmSync(path.join(P.marca, 'logo.' + e), { force: true });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1];
      fs.writeFileSync(path.join(P.marca, 'logo.' + ext), Buffer.from(m[2], 'base64'));
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/logo' && req.method === 'DELETE') {
      for (const e of ['png', 'jpg', 'webp', 'svg']) fs.rmSync(path.join(P.marca, 'logo.' + e), { force: true });
      return json(res, 200, { ok: true });
    }

    // narração: vozes disponíveis
    if (rota === '/api/vozes') return json(res, 200, VOZES_NEURAIS);

    // login lembrado
    if (rota === '/api/perfis' && req.method === 'GET') return json(res, 200, listarPerfis());
    if (rota === '/api/perfis/entrar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { perfil, url: endereco, config } = await lerCorpo(req);
      if (!String(perfil || '').trim()) return json(res, 400, { erro: 'Dê um nome ao login (ex.: "loja-admin").' });
      comecar();
      atualizar({ fase: 'login', mensagem: `Faça o login na janela que abriu e depois feche-a. O login fica guardado em "${perfil}".` });
      entrarNoSite(slugPerfil(perfil), endereco, config)
        .then(() => atualizar({ ocupado: false, fase: 'parado', mensagem: `Login "${slugPerfil(perfil)}" guardado. Escolha-o no roteiro para usar.` }))
        .catch((e) => atualizar({ ocupado: false, fase: 'erro', erro: 'Não consegui abrir o navegador: ' + e.message, mensagem: 'Algo deu errado.' }));
      return json(res, 200, { ok: true, perfil: slugPerfil(perfil) });
    }
    if (rota === '/api/perfis/apagar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Espere o trabalho atual terminar.' });
      const { perfil } = await lerCorpo(req);
      const alvo = path.join(P.perfis, slugPerfil(perfil));
      if (alvo.startsWith(P.perfis + path.sep)) fs.rmSync(alvo, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }

    // atualização e preferências do programa
    if (rota === '/api/atualizacao') return json(res, 200, await verificarAtualizacao(url.searchParams.get('forcar') === '1'));
    if (rota === '/api/preferencias' && req.method === 'GET') return json(res, 200, { ...lerPrefs(), versao: VERSAO });
    if (rota === '/api/preferencias' && req.method === 'PUT') {
      const novo = { ...lerPrefs(), ...(await lerCorpo(req)) };
      delete novo.versao;
      fs.writeFileSync(ARQ_PREFS, JSON.stringify(novo, null, 2));
      cacheAtualizacao = { quando: 0, dados: null };
      return json(res, 200, novo);
    }

    // apontar no site (a resposta só volta quando o usuário clicar)
    if (rota === '/api/apontar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { roteiro, indice } = await lerCorpo(req);
      cancelar = false;
      atualizar({ ocupado: true, fase: 'apontando', indice, erro: null, erroImagem: null, erroIndice: null, pct: 0, mensagem: 'Abrindo o site…' });
      try {
        const r = await apontar({ roteiro, indice, cancelado: () => cancelar, aoMensagem: (m) => atualizar({ mensagem: m }) });
        atualizar({ ocupado: false, fase: 'parado', indice: null, mensagem: r.conferir ? `Alvo preenchido: "${r.alvo}". Confira com "Testar".` : `Alvo preenchido: "${r.alvo}".` });
        return json(res, 200, r);
      } catch (e) {
        const cancelou = /^Cancelado/.test(e.message);
        atualizar({ ocupado: false, fase: cancelou ? 'parado' : 'erro', indice: null, mensagem: cancelou ? 'Apontar cancelado.' : 'Não consegui chegar a esse passo.',
          erro: cancelou ? null : (e.indice !== undefined ? `Passo ${e.indice + 1}: ` : '') + e.message, erroIndice: e.indice ?? null });
        return json(res, 400, { erro: e.message, cancelado: cancelou });
      }
    }

    // gravar navegando
    if (rota === '/api/capturar' && req.method === 'POST') {
      if (estado.ocupado) return json(res, 409, { erro: 'Já existe um trabalho em andamento.' });
      const { url: endereco, config } = await lerCorpo(req);
      pararCaptura = false;
      atualizar({ ocupado: true, fase: 'navegando', erro: null, erroImagem: null, erroIndice: null, captura: null, mensagem: 'Abrindo o site…' });
      capturar({
        url: endereco, config,
        parar: () => pararCaptura,
        aoPasso: (passos) => atualizar({ captura: passos, mensagem: `Navegue normalmente no site. ${passos.length} passo(s) anotado(s). Quando terminar, feche a janela ou clique em "Terminar".` })
      })
        .then((passos) => atualizar({ ocupado: false, fase: 'capturado', captura: passos, mensagem: `${passos.length} passos anotados. Escolha o que fazer com eles.` }))
        .catch((e) => atualizar({ ocupado: false, fase: 'erro', erro: e.message, mensagem: 'Algo deu errado.' }));
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/capturar/parar' && req.method === 'POST') { pararCaptura = true; return json(res, 200, { ok: true }); }
    if (rota === '/api/capturar/limpar' && req.method === 'POST') {
      atualizar({ captura: null, fase: 'parado', mensagem: 'Pronto para gravar.' });
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/cancelar' && req.method === 'POST') {
      cancelar = true; pararCaptura = true; pausar = false;
      if (estado.ocupado) atualizar({ pausado: false, mensagem: 'Parando…' });
      return json(res, 200, { ok: true });
    }
    if (rota === '/api/pausar' && req.method === 'POST') {
      if (!estado.ocupado || !['gravando', 'testando'].includes(estado.fase)) return json(res, 400, { erro: 'Nada para pausar agora.' });
      pausar = !pausar;
      atualizar({ pausado: pausar, mensagem: pausar ? 'Pausando… (para no fim do passo atual)' : 'Continuando…' });
      return json(res, 200, { pausado: pausar });
    }
    if (rota === '/api/abrir-pasta' && req.method === 'POST') { abrirNoSistema(P.videos); return json(res, 200, { ok: true }); }
    if (rota === '/api/abrir-pasta-musicas' && req.method === 'POST') { abrirNoSistema(P.musicas); return json(res, 200, { ok: true }); }

    // arquivos
    if (rota.startsWith('/jobs/')) { const m = rota.match(/^\/jobs\/([^/]+)\/quadros\/([^/]+)$/); if (m) return servirArquivo(req, res, path.join(P.jobs, seguro(m[1]), 'quadros', seguro(m[2]))); }
    if (rota.startsWith('/gravacoes/')) { const a = dentro(P.jobs, rota.slice(11)); if (a) return servirArquivo(req, res, a); }
    if (rota.startsWith('/videos/')) return servirArquivo(req, res, path.join(P.videos, seguro(rota.slice(8))));  // ?v= é ignorado
    if (rota === '/demo') { res.writeHead(302, { Location: '/demo/' }); return res.end(); }
    if (rota.startsWith('/demo/')) {
      let rel = rota.slice(6) || 'index.html';
      if (rel.endsWith('/')) rel += 'index.html';
      const a = dentro(P.demo, rel);
      if (a) return servirArquivo(req, res, a);
    }
    if (rota === '/favicon.ico') return servirArquivo(req, res, path.join(RAIZ, 'clickreel.ico'));
    const rel = rota === '/' ? 'index.html' : rota.slice(1);
    const a = dentro(P.publico, rel);
    if (a) return servirArquivo(req, res, a);
    res.writeHead(404); res.end('Não encontrado');
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
});
servidor.requestTimeout = 0; // "Apontar" espera o clique do usuário

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\nO painel já está aberto em http://localhost:${PORTA}\n`);
    abrirNoSistema(`http://localhost:${PORTA}`);
    setTimeout(() => process.exit(0), 1500);
  } else throw e;
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log('\n  ClickReel está rodando.');
  console.log(`  Painel: http://localhost:${PORTA}`);
  console.log('  Deixe esta janela aberta enquanto usa. Para encerrar, feche-a.\n');
  if (!process.env.NAO_ABRIR) abrirNoSistema(`http://localhost:${PORTA}`);
});
