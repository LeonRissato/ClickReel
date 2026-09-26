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

// tempo original → tempo de saída (inverso do mapa)
function tempoSaida(mapa, t) {
  const p = mapa.pecas.find((x) => t >= x.s0 && t <= x.s1);
  if (!p) return t < (mapa.pecas[0] ? mapa.pecas[0].s0 : 0) ? 0 : mapa.duracao;
  const f = p.s1 > p.s0 ? (t - p.s0) / (p.s1 - p.s0) : 0;
  return p.o0 + f * (p.o1 - p.o0);
}

function rodarFfmpeg(args) {
  return new Promise((res, rej) => {
    const ff = spawn(caminhoFfmpeg(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    ff.stderr.on('data', (d) => { log = (log + d).slice(-3000); });
    ff.on('error', rej);
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error('O ffmpeg falhou:\n' + log.split('\n').slice(-5).join('\n')))));
  });
}

const tempoSrt = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, d = 2) => String(n).padStart(d, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

async function renderizar({ jobDir, jobId, baseUrl, config: configNova, arquivoSaida, pastaMusicas, arquivoLogo = null, narracoes = [], previa = false, aoProgredir = () => {}, cancelado = () => false }) {
  const linha = JSON.parse(fs.readFileSync(path.join(jobDir, 'linha-do-tempo.json'), 'utf8'));
  // o formato vem sempre da gravação (o site foi aberto naquele tamanho)
  const config = comPadrao({ ...configNova, formato: linha.formato || (configNova && configNova.formato) });
  const saida = saidaDe(config);
  const fps = previa ? 15 : Number(config.fps) === 60 ? 60 : 30;
  const mapa = montarMapaTempo(linha, config.acelerarCarregamentos);
  const fator = previa ? 0.5 : fatorResolucao(config);
  const maxima = !previa && config.qualidade === 'maxima';

  // abertura e encerramento
  const I = config.abertura ? Math.max(1, Number(config.aberturaSegundos) || 3) : 0;
  const E = config.encerramento ? Math.max(1, Number(config.encerramentoSegundos) || 4) : 0;
  const M = mapa.duracao;
  const D = I + M + E;
  const totalQuadros = Math.max(1, Math.ceil(D * fps));

  // QR code do encerramento
  let qrSvg = '';
  if (config.encerramento && config.encerramentoQr && config.encerramentoUrl) {
    try { qrSvg = await require('qrcode').toString(String(config.encerramentoUrl), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch (_) {}
  }
  const temLogo = !!(arquivoLogo && fs.existsSync(arquivoLogo));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: saida, deviceScaleFactor: fator });
  // o recorte com escala faz o Chrome redesenhar na resolução final (1440p/4K) sem esticar
  const recorte = { x: 0, y: 0, width: saida.width, height: saida.height, scale: fator };
  const page = await context.newPage();
  await page.goto(`${baseUrl}/compositor.html`);
  await page.evaluate(
    ({ linha, config, saida, base, extras }) => window.iniciar(linha, config, saida, base, extras),
    { linha, config, saida, base: `${baseUrl}/jobs/${jobId}/quadros/`, extras: { qrSvg, logoUrl: temLogo ? `${baseUrl}/logo?${Date.now()}` : '' } }
  );
  const cdp = await context.newCDPSession(page);

  // ---------- áudio: música + narração ----------
  const args = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
  let musica = null;
  if (config.musica && pastaMusicas) {
    const m = path.join(pastaMusicas, path.basename(config.musica));
    if (fs.existsSync(m)) musica = m;
  }
  // início de cada fala = início do passo (convertido para o tempo do vídeo)
  const localParaOriginal = (linha.roteiro && linha.roteiro.passos || []).map((p, k) => (p._i !== undefined ? p._i : k));
  const falas = [];
  for (const n of narracoes || []) {
    const reg = (linha.passos || []).find((r) => localParaOriginal[r.i] === n.indice);
    if (!reg || !fs.existsSync(n.arquivo)) continue;
    falas.push({ arquivo: n.arquivo, em: I + tempoSaida(mapa, Math.max(reg.t0, linha.inicio)) });
  }
  const filtros = [];
  const rotulos = [];
  let idx = 1;
  if (musica) {
    args.push('-stream_loop', '-1', '-i', musica);
    const vol = Math.max(0, Math.min(1, Number(config.volumeMusica) || 0.5)) * (falas.length ? 0.35 : 1);
    filtros.push(`[${idx}:a]atrim=0:${D.toFixed(2)},volume=${vol.toFixed(3)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, D - 2).toFixed(2)}:d=2[mus]`);
    rotulos.push('[mus]');
    idx++;
  }
  const volFala = Math.max(0.1, Math.min(2, Number(config.volumeNarracao) || 1));
  falas.forEach((f, k) => {
    args.push('-i', f.arquivo);
    const ms = Math.round(f.em * 1000);
    filtros.push(`[${idx}:a]aresample=48000,adelay=${ms}|${ms},volume=${volFala.toFixed(2)}[f${k}]`);
    rotulos.push(`[f${k}]`);
    idx++;
  });
  if (rotulos.length) {
    filtros.push(`${rotulos.join('')}amix=inputs=${rotulos.length}:normalize=0:duration=longest,apad[aout]`);
    args.push('-filter_complex', filtros.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }
  args.push('-c:v', 'libx264',
    '-preset', previa ? 'ultrafast' : maxima ? 'slow' : 'medium',
    '-crf', previa ? '30' : maxima ? '14' : '18',
    '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', arquivoSaida);

  const ff = spawn(caminhoFfmpeg(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let logFf = '';
  ff.stderr.on('data', (d) => { logFf = (logFf + d.toString()).slice(-4000); });
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

  const tsDe = (om) => tempoOriginal(mapa, Math.max(0, Math.min(M - 1e-3, om)));
  try {
    for (let n = 0; n < totalQuadros; n++) {
      if (cancelado()) throw new Error('Renderização cancelada.');
      const o = n / fps;
      if (o < I) {
        await page.evaluate(([ts, p]) => window.desenharCartao('abertura', p, ts), [tsDe(0), o / I]);
      } else if (o < I + M) {
        await page.evaluate(([ts, om]) => window.desenhar(ts, om), [tsDe(o - I), o - I]);
      } else {
        await page.evaluate(([ts, p]) => window.desenharCartao('encerramento', p, ts), [tsDe(M), (o - I - M) / E]);
      }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: previa ? 80 : maxima ? 98 : 94, optimizeForSpeed: !maxima, clip: recorte });
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

  // ---------- arquivos extras ----------
  const base = arquivoSaida.replace(/\.mp4$/i, '');
  const extras = {};
  if (!previa && config.gerarSrt) {
    const leg = (linha.passos || []).filter((p) => p.legenda && p.legenda.trim())
      .map((p) => ({ t: I + tempoSaida(mapa, Math.max(p.t0, linha.inicio)), texto: p.legenda.trim() }))
      .sort((a, b) => a.t - b.t);
    const blocos = [];
    leg.forEach((l, k) => {
      if (l.texto === '-') return;
      const fim = k + 1 < leg.length ? leg[k + 1].t : I + M;
      if (fim - l.t > 0.2) blocos.push(`${blocos.length + 1}\n${tempoSrt(l.t)} --> ${tempoSrt(fim)}\n${l.texto}\n`);
    });
    if (blocos.length) { fs.writeFileSync(base + '.srt', blocos.join('\n'), 'utf8'); extras.srt = base + '.srt'; }
  }
  if (!previa && config.gerarCapa) {
    aoProgredir({ pct: 100, extra: 'Gerando a capa…' });
    const t = config.abertura ? I * 0.55 : I + Math.min(M * 0.35, 6);
    await rodarFfmpeg(['-y', '-ss', t.toFixed(2), '-i', arquivoSaida, '-frames:v', '1', '-q:v', '2', base + '-capa.jpg']);
    extras.capa = base + '-capa.jpg';
  }
  if (!previa && config.gerarGif) {
    aoProgredir({ pct: 100, extra: 'Gerando o GIF…' });
    const largura = Math.max(240, Math.min(1080, Number(config.gifLargura) || 640));
    const maxS = Math.max(3, Number(config.gifSegundosMax) || 15);
    const vel = D > maxS ? D / maxS : 1; // acelera para caber no tempo máximo
    const f = `setpts=PTS/${vel.toFixed(3)},fps=12,scale=${largura}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
    await rodarFfmpeg(['-y', '-i', arquivoSaida, '-filter_complex', f, '-loop', '0', base + '.gif']);
    extras.gif = base + '.gif';
  }
  return { duracao: D, quadros: totalQuadros, extras };
}

module.exports = { renderizar, montarMapaTempo, tempoSaida, caminhoFfmpeg };
