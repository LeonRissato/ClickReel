// Narração automática: transforma o texto de cada passo em fala.
// Motores:
//   'neural'  → vozes neurais da Microsoft (Edge), gratuitas, precisam de internet
//   'windows' → voz instalada no Windows (offline); usa a voz em português se existir
//   'auto'    → tenta a neural e cai para a do Windows sem internet
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VOZES_NEURAIS = {
  'pt-BR-FranciscaNeural': 'Francisca (feminina)',
  'pt-BR-AntonioNeural': 'Antônio (masculina)',
  'pt-BR-ThalitaMultilingualNeural': 'Thalita (feminina, jovem)'
};

// Texto que a voz fala em cada passo: campo "narração" ou, se ligado, a legenda
function textoDoPasso(passo, config) {
  const proprio = String(passo.narracao || '').trim();
  if (proprio === '-') return '';
  if (proprio) return proprio;
  if (config.narracaoUsarLegendas === false) return '';
  const leg = String(passo.legenda || '').trim();
  if (!leg || leg === '-') return '';
  return leg.replace(/^\s*\d+\s*[.)\-–]\s*/, ''); // "1. Escolha" → "Escolha"
}

function duracaoAudio(ffmpeg, arquivo) {
  return new Promise((res) => {
    execFile(ffmpeg, ['-hide_banner', '-i', arquivo], (_e, _o, err) => {
      const m = String(err || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      res(m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0);
    });
  });
}

async function falarNeural(texto, arquivo, voz, velocidade) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const tmp = fs.mkdtempSync(arquivo + '-');
  const rate = `${velocidade >= 0 ? '+' : ''}${Math.round(velocidade)}%`;
  const r = await Promise.race([
    tts.toFile(tmp, texto, { rate }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('sem resposta do serviço de voz')), 20000))
  ]);
  fs.renameSync(r.audioFilePath, arquivo);
  fs.rmSync(tmp, { recursive: true, force: true });
  try { tts.close(); } catch (_) {}
}

function falarWindows(texto, arquivo, velocidade) {
  if (process.platform !== 'win32') return Promise.reject(new Error('a voz do Windows só funciona no Windows'));
  const txt = arquivo + '.txt';
  fs.writeFileSync(txt, texto, 'utf8');
  const rate = Math.max(-10, Math.min(10, Math.round(velocidade / 10)));
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'pt-*' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = ${rate}
$s.SetOutputToWaveFile('${arquivo.replace(/'/g, "''")}')
$s.Speak((Get-Content -Raw -Encoding UTF8 '${txt.replace(/'/g, "''")}'))
$s.Dispose()`;
  return new Promise((res, rej) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (c) => { fs.rmSync(txt, { force: true }); c === 0 && fs.existsSync(arquivo) ? res() : rej(new Error('voz do Windows falhou: ' + err.slice(-200))); });
  });
}

// Gera (ou reaproveita do cache) um arquivo de fala por passo.
// Devolve [{ indice, texto, arquivo, duracao }]
async function gerarNarracoes({ passos, config, pastaCache, ffmpeg, aoProgredir = () => {} }) {
  if (!config.narracaoAtiva) return [];
  fs.mkdirSync(pastaCache, { recursive: true });
  const motor = config.narracaoMotor || 'auto';
  const voz = VOZES_NEURAIS[config.narracaoVoz] ? config.narracaoVoz : 'pt-BR-FranciscaNeural';
  const vel = Number(config.narracaoVelocidade) || 0;
  const itens = passos.map((p, i) => ({ indice: p._i ?? i, texto: textoDoPasso(p, config) })).filter((x) => x.texto);
  const saida = [];
  let usarWindows = motor === 'windows';
  for (let k = 0; k < itens.length; k++) {
    const it = itens[k];
    aoProgredir(`Gerando a narração ${k + 1} de ${itens.length}…`);
    const chave = crypto.createHash('sha1').update([usarWindows ? 'win' : voz, vel, it.texto].join('|')).digest('hex').slice(0, 16);
    let arquivo = path.join(pastaCache, chave + (usarWindows ? '.wav' : '.mp3'));
    if (!fs.existsSync(arquivo)) {
      try {
        if (usarWindows) await falarWindows(it.texto, arquivo, vel);
        else await falarNeural(it.texto, arquivo, voz, vel);
      } catch (e) {
        if (!usarWindows && motor === 'auto') {
          usarWindows = true; // sem internet: passa a usar a voz do Windows
          arquivo = path.join(pastaCache, chave + '.wav');
          await falarWindows(it.texto, arquivo, vel);
        } else throw new Error('Não consegui gerar a narração: ' + e.message);
      }
    }
    saida.push({ ...it, arquivo, duracao: await duracaoAudio(ffmpeg, arquivo) });
  }
  return saida;
}

module.exports = { gerarNarracoes, textoDoPasso, VOZES_NEURAIS };
