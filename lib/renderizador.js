// Monta o vídeo final: abre public/compositor.html num Chromium invisível,
// desenha quadro a quadro (tela gravada + cursor + zoom + legendas + moldura),
// tira uma "foto" de cada quadro e envia para o ffmpeg gerar o MP4.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { comPadrao, saidaDe, fatorResolucao } = require('./config');

function caminhoFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}
  return 'ffmpeg';
}

// Mapa tempo-de-saída → tempo-original, encurtando os trechos de carregamento.
function montarMapaTempo(linha, acelerar) {
  const ini = linha.inicio;
  const fim = linha.fim;
  let trechos = [];
  if (acelerar) {
    trechos = (linha.carregando || [])
      .map((c) => ({ t0: Math.max(ini, c.t0), t1: Math.min(fim, c.t1) }))
      .filter((c) => c.t1 - c.t0 > 0.3)
      .sort((a, b) => a.t0 - b.t0);
    const unidos = [];
    for (const c of trechos) {
      const u = unidos[unidos.length - 1];
      if (u && c.t0 <= u.t1) u.t1 = Math.max(u.t1, c.t1);
      else unidos.push({ ...c });
    }
    trechos = unidos;
  }
  const pecas = []; // { o0, o1, s0, s1 }
  let s = ini;
  let o = 0;
  const add = (s0, s1, durSaida) => {
    if (s1 <= s0) return;
    pecas.push({ o0: o, o1: o + durSaida, s0, s1 });
    o += durSaida;
  };
  for (const c of trechos) {
    add(s, c.t0, c.t0 - s);
    const d = c.t1 - c.t0;
    const dSaida = d <= 0.8 ? d : 0.8 + (d - 0.8) * 0.12;
    add(c.t0, c.t1, dSaida);
    s = c.t1;
  }
  add(s, fim, fim - s);
  return { pecas, duracao: o };
}

function tempoOriginal(mapa, o) {
  const p = mapa.pecas.find((x) => o >= x.o0 && o < x.o1) || mapa.pecas[mapa.pecas.length - 1];
  if (!p) return 0;
  const f = p.o1 > p.o0 ? (o - p.o0) / (p.o1 - p.o0) : 0;
  return p.s0 + Math.min(1, Math.max(0, f)) * (p.s1 - p.s0);
}

async function renderizar({ jobDir, jobId, baseUrl, config: configNova, arquivoSaida, pastaMusicas, aoProgredir = () => {}, cancelado = () => false }) {
  const linha = JSON.parse(fs.readFileSync(path.join(jobDir, 'linha-do-tempo.json'), 'utf8'));
  // o formato vem sempre da gravação (o site foi aberto naquele tamanho)
  const config = comPadrao({ ...configNova, formato: linha.formato || (configNova && configNova.formato) });
  const saida = saidaDe(config);
  const fps = Number(config.fps) === 60 ? 60 : 30;
  const mapa = montarMapaTempo(linha, config.acelerarCarregamentos);
  const totalQuadros = Math.max(1, Math.ceil(mapa.duracao * fps));

  const browser = await chromium.launch({ headless: true });
  // o layout é sempre montado em 1080p; a resolução final vem da escala (1440p = 1,33x, 4K = 2x)
  const context = await browser.newContext({ viewport: saida, deviceScaleFactor: fatorResolucao(config) });
  const maxima = config.qualidade === 'maxima';
  // o recorte com escala faz o Chrome redesenhar na resolução final (1440p/4K) sem esticar
  const recorte = { x: 0, y: 0, width: saida.width, height: saida.height, scale: fatorResolucao(config) };
  const page = await context.newPage();
  await page.goto(`${baseUrl}/compositor.html`);
  await page.evaluate(
    ({ linha, config, saida, base }) => window.iniciar(linha, config, saida, base),
    { linha, config, saida, base: `${baseUrl}/jobs/${jobId}/quadros/` }
  );
  const cdp = await context.newCDPSession(page);

  // ffmpeg
  const args = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  let musica = null;
  if (config.musica && pastaMusicas) {
    const m = path.join(pastaMusicas, path.basename(config.musica));
    if (fs.existsSync(m)) musica = m;
  }
  if (musica) args.push('-stream_loop', '-1', '-i', musica);
  args.push('-c:v', 'libx264', '-preset', maxima ? 'slow' : 'medium', '-crf', maxima ? '14' : '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart');
  if (musica) {
    const d = mapa.duracao;
    const vol = Math.max(0, Math.min(1, Number(config.volumeMusica) || 0.5));
    args.push(
      '-map', '0:v', '-map', '1:a',
      '-af', `volume=${vol},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, d - 2).toFixed(2)}:d=2`,
      '-c:a', 'aac', '-b:a', '192k', '-shortest'
    );
  }
  args.push(arquivoSaida);

  const ff = spawn(caminhoFfmpeg(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let logFf = '';
  ff.stderr.on('data', (d) => {
    logFf = (logFf + d.toString()).slice(-4000);
  });
  const terminou = new Promise((res, rej) => {
    ff.on('error', (e) => rej(new Error('Não consegui iniciar o ffmpeg: ' + e.message)));
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error('O ffmpeg falhou:\n' + logFf.split('\n').slice(-6).join('\n')))));
  });
  let erroStdin = null;
  ff.stdin.on('error', (e) => { erroStdin = e; });
  const escrever = (buf) =>
    new Promise((res, rej) => {
      if (erroStdin) return rej(new Error('O ffmpeg parou de responder:\n' + logFf.split('\n').slice(-6).join('\n')));
      if (!ff.stdin.write(buf)) ff.stdin.once('drain', res);
      else res();
    });

  try {
    for (let n = 0; n < totalQuadros; n++) {
      if (cancelado()) throw new Error('Renderização cancelada.');
      const o = n / fps;
      const ts = tempoOriginal(mapa, o);
      await page.evaluate(([ts, o]) => window.desenhar(ts, o), [ts, o]);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: maxima ? 98 : 94, optimizeForSpeed: !maxima, clip: recorte });
      await escrever(Buffer.from(data, 'base64'));
      if (n % 10 === 0 || n === totalQuadros - 1) aoProgredir({ pct: Math.round(((n + 1) / totalQuadros) * 100) });
    }
  } catch (e) {
    ff.stdin.destroy();
    ff.kill();
    await browser.close().catch(() => {});
    throw e;
  }
  ff.stdin.end();
  await browser.close();
  await terminou;
  return { duracao: mapa.duracao, quadros: totalQuadros };
}

module.exports = { renderizar, montarMapaTempo };
