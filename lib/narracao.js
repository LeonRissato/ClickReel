// Narração automática: transforma o texto de cada passo em fala.
// Motores:
//   'neural'  → vozes neurais da Microsoft (Edge), gratuitas, precisam de internet
//   'windows' → voz instalada no Windows (offline); usa a voz em português se existir
//   'auto'    → tenta a neural e cai para a do Windows sem internet
//   'elevenlabs' → vozes da ElevenLabs (paga, precisa da chave da API)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VOZES_NEURAIS = {
  'pt-BR-FranciscaNeural': 'Francisca (feminina)',
  'pt-BR-AntonioNeural': 'Antônio (masculina)',
  'pt-BR-ThalitaMultilingualNeural': 'Thalita (feminina, jovem)'
};

// ---------------- ElevenLabs ----------------
const ELEVEN_API = process.env.CLICKREEL_ELEVEN_API || 'https://api.elevenlabs.io';
const MODELOS_ELEVEN = {
  eleven_multilingual_v2: 'Multilingual v2 — melhor qualidade',
  eleven_flash_v2_5: 'Flash v2.5 — rápido, gasta metade dos créditos',
  eleven_v3: 'v3 — mais expressivo'
};
const MODELO_ELEVEN_PADRAO = 'eleven_multilingual_v2';

// Traduz as respostas de erro da ElevenLabs para algo que dá para agir
function erroEleven(status, corpo) {
  let det = {};
  try { det = JSON.parse(corpo).detail || {}; } catch (_) {}
  const cod = typeof det === 'object' ? det.status || det.code || '' : '';
  const msg = typeof det === 'string' ? det : det.message || '';
  if (status === 401 && /missing_permissions/.test(cod + msg)) return new Error('a chave da ElevenLabs não tem permissão para isso (' + msg + '). Crie a chave com acesso a "Text to Speech" e "Voices".');
  if (status === 401 && /quota_exceeded/.test(cod + msg)) return new Error('acabaram os créditos da ElevenLabs deste mês. ' + msg);
  if (status === 401) return new Error('a chave da ElevenLabs não foi aceita. Confira se copiou a chave inteira.');
  if (status === 402 || /quota_exceeded|payment/.test(cod)) return new Error('acabaram os créditos da ElevenLabs (ou o plano não permite). ' + msg);
  if (status === 404 || /voice_not_found/.test(cod)) return new Error('a voz escolhida não existe mais na sua conta da ElevenLabs. Escolha outra.');
  if (status === 429) return new Error('a ElevenLabs pediu para ir mais devagar (muitos pedidos ao mesmo tempo). Tente de novo em instantes.');
  return new Error(`a ElevenLabs respondeu com erro ${status}${msg ? ': ' + msg : ''}`);
}

async function pedirEleven(chave, caminho, opcoes = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opcoes.tempo || 60000);
  try {
    const r = await fetch(ELEVEN_API + caminho, {
      ...opcoes,
      signal: ctl.signal,
      headers: { 'xi-api-key': chave, ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...(opcoes.headers || {}) }
    });
    if (!r.ok) throw erroEleven(r.status, await r.text().catch(() => ''));
    return r;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('a ElevenLabs demorou demais para responder.');
    if (e.cause && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/.test(String(e.cause.code))) throw new Error('sem conexão com a ElevenLabs (confira a internet).');
    throw e;
  } finally { clearTimeout(timer); }
}

// Vozes da conta (as próprias, clonadas e as que foram adicionadas da biblioteca)
async function vozesEleven(chave) {
  const r = await pedirEleven(chave, '/v1/voices', { tempo: 20000 });
  const { voices = [] } = await r.json();
  return voices.map((v) => {
    const l = v.labels || {};
    const info = [l.gender === 'female' ? 'feminina' : l.gender === 'male' ? 'masculina' : l.gender, l.accent, l.age, l.description || l.descriptive, l.use_case]
      .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
    return { id: v.voice_id, nome: v.name, info, amostra: v.preview_url || '', categoria: v.category || '' };
  }).sort((a, b) => a.nome.localeCompare(b.nome));
}

// Uso do plano (nem toda chave tem permissão para ler isso — aí devolve null)
async function usoEleven(chave) {
  try {
    const r = await pedirEleven(chave, '/v1/user/subscription', { tempo: 15000 });
    const s = await r.json();
    return { plano: s.tier || '', usados: s.character_count ?? null, limite: s.character_limit ?? null, renova: s.next_character_count_reset_unix || null };
  } catch (_) { return null; }
}

async function falarEleven(texto, arquivo, { chave, voz, modelo, velocidade }) {
  if (!chave) throw new Error('falta a chave da API da ElevenLabs (Narração → ElevenLabs).');
  if (!voz) throw new Error('escolha uma voz da ElevenLabs.');
  const model_id = MODELOS_ELEVEN[modelo] ? modelo : MODELO_ELEVEN_PADRAO;
  const corpo = {
    text: texto,
    model_id,
    // velocidade do painel (-30%…+30%) → 0,7…1,2 aceitos pela ElevenLabs
    voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.max(0.7, Math.min(1.2, 1 + (Number(velocidade) || 0) / 100)) }
  };
  if (/_v2_5$/.test(model_id)) corpo.language_code = 'pt'; // só esses modelos aceitam fixar o idioma
  let r;
  for (let tentativa = 0; ; tentativa++) {
    try {
      r = await pedirEleven(chave, `/v1/text-to-speech/${encodeURIComponent(voz)}?output_format=mp3_44100_128`, { method: 'POST', body: JSON.stringify(corpo) });
      break;
    } catch (e) {
      if (tentativa === 0 && /mais devagar/.test(e.message)) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      throw e;
    }
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('a ElevenLabs devolveu um áudio vazio.');
  fs.writeFileSync(arquivo, buf);
}

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
async function gerarNarracoes({ passos, config, pastaCache, ffmpeg, chaveEleven = '', aoProgredir = () => {} }) {
  if (!config.narracaoAtiva) return [];
  if ((config.narracaoMotor || 'auto') === 'elevenlabs') return gerarComEleven({ passos, config, pastaCache, ffmpeg, chaveEleven, aoProgredir });
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

async function gerarComEleven({ passos, config, pastaCache, ffmpeg, chaveEleven, aoProgredir }) {
  fs.mkdirSync(pastaCache, { recursive: true });
  const voz = config.narracaoVozEleven || '';
  const modelo = MODELOS_ELEVEN[config.narracaoModeloEleven] ? config.narracaoModeloEleven : MODELO_ELEVEN_PADRAO;
  const vel = Number(config.narracaoVelocidade) || 0;
  const itens = passos.map((p, i) => ({ indice: p._i ?? i, texto: textoDoPasso(p, config) })).filter((x) => x.texto);
  const saida = [];
  for (let k = 0; k < itens.length; k++) {
    const it = itens[k];
    // falas já geradas ficam guardadas: regravar o vídeo não gasta créditos de novo
    const chave = crypto.createHash('sha1').update(['eleven', voz, modelo, vel, it.texto].join('|')).digest('hex').slice(0, 16);
    const arquivo = path.join(pastaCache, chave + '.mp3');
    if (!fs.existsSync(arquivo)) {
      aoProgredir(`Gerando a narração ${k + 1} de ${itens.length} na ElevenLabs…`);
      try { await falarEleven(it.texto, arquivo, { chave: chaveEleven, voz, modelo, velocidade: vel }); }
      catch (e) { fs.rmSync(arquivo, { force: true }); throw new Error('Não consegui gerar a narração: ' + e.message); }
    }
    saida.push({ ...it, arquivo, duracao: await duracaoAudio(ffmpeg, arquivo) });
  }
  return saida;
}

module.exports = { gerarNarracoes, textoDoPasso, VOZES_NEURAIS, MODELOS_ELEVEN, vozesEleven, usoEleven };
