// Painel do ClickReel
const ACOES = {
  abrir: { rotulo: 'Abrir página', campos: [['url', 'Endereço', 'https://seusite.com.br/produto']] },
  clicar: { rotulo: 'Clicar', campos: [['alvo', 'Alvo (texto do botão, link…)', 'Adicionar ao carrinho']], zoom: true },
  digitar: { rotulo: 'Digitar', campos: [['alvo', 'Campo (rótulo ou placeholder)', 'E-mail'], ['texto', 'Texto a digitar', 'maria@exemplo.com']], zoom: true },
  selecionar: { rotulo: 'Escolher opção', campos: [['alvo', 'Lista (rótulo)', 'Estado'], ['texto', 'Opção', 'São Paulo']], zoom: true },
  passar: { rotulo: 'Passar o mouse', campos: [['alvo', 'Alvo', 'Menu Livros']], zoom: true },
  rolar: { rotulo: 'Rolar a página', campos: [['alvo', 'Até o elemento (opcional)', 'Descrição'], ['pixels', 'ou pixels', '600', 'curto']] },
  tecla: { rotulo: 'Apertar tecla', campos: [['tecla', 'Tecla', 'Enter', 'curto']] },
  aguardar: { rotulo: 'Aguardar aparecer', campos: [['alvo', 'Texto que deve aparecer', 'Pedido recebido'], ['segundos', 'Esperar no máximo (s)', '20', 'curto'], ['recarregar', 'Recarregar a cada (s)', 'não', 'curto']] },
  esperar: { rotulo: 'Pausa', campos: [['segundos', 'Segundos', '1.5', 'curto']] },
  destacar: { rotulo: 'Destacar elemento', campos: [['alvo', 'Elemento a destacar', 'R$ 79,90'], ['texto', 'Texto do balão (opcional)', 'Preço de pré-venda'], ['segundos', 'Segundos', '2.5', 'curto']], zoom: true },
  legenda: { rotulo: 'Só mostrar legenda', campos: [['segundos', 'Segundos na tela', '2.5', 'curto']] }
};
const FUNDOS = {
  ameixa: 'linear-gradient(135deg,#3a1257,#8e2c74,#d0566c)',
  oceano: 'linear-gradient(135deg,#0b2447,#19376d,#23a6b8)',
  'por-do-sol': 'linear-gradient(135deg,#f0626b,#f79b5b,#fcd280)',
  grafite: 'linear-gradient(135deg,#141619,#2b2f36,#434954)',
  floresta: 'linear-gradient(135deg,#0d3b36,#1f6f50,#8fbf4d)',
  claro: 'linear-gradient(135deg,#f3eefb,#e3dcf1,#d4e4f7)'
};
const SENSIVEL = /\b(cpf|cnpj|rg|cart[aã]o|n[uú]mero do cart|cvv|cvc|c[oó]digo de seguran|senha|password|validade)\b/i;
const vaiBorrar = (p) => (p.borrar === true || p.borrar === false ? p.borrar : SENSIVEL.test(String(p.alvo || '')));
let PADRAO = { telaDesktop: '1280x720', resolucao: '1080p', esconder: '', formato: 'horizontal', moldura: true, fundo: 'ameixa', zoom: 1.8, velocidade: 'normal', fps: 30, qualidade: 'alta', mostrarNavegador: false, acelerarCarregamentos: true, mostrarUrl: true, cursor: true, estiloLegenda: 'escuro', musica: '', volumeMusica: 0.5 };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let arquivo = null;
let roteiro = null;
let alterado = false;
let estado = {};

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status);
  return d;
}
function marcarAlterado(v = true) {
  alterado = v;
  $('#aviso-salvo').textContent = v ? 'alterações não salvas' : 'salvo';
}

// ---------------- roteiros ----------------
async function carregarLista(selecionar) {
  const lista = await api('/api/roteiros');
  const sel = $('#lista-roteiros');
  sel.innerHTML = lista.map((r) => `<option value="${r.arquivo}">${esc(r.nome)}</option>`).join('');
  if (!lista.length) { await novo('Meu primeiro roteiro'); return; }
  const alvo = selecionar || localStorageGet('ultimoRoteiro') || lista[0].arquivo;
  sel.value = lista.some((r) => r.arquivo === alvo) ? alvo : lista[0].arquivo;
  await abrir(sel.value);
}
async function abrir(arq) {
  roteiro = await api('/api/roteiros/' + encodeURIComponent(arq));
  roteiro.passos = roteiro.passos || [];
  roteiro.config = { ...PADRAO, ...(roteiro.config || {}) };
  arquivo = arq;
  localStorageSet('ultimoRoteiro', arq);
  renderTudo();
  if ($('#vozes').options.length) $('#vozes').value = roteiro.config.narracaoVoz || 'pt-BR-FranciscaNeural';
  if (typeof carregarPerfis === 'function' && $('#perfis').options.length) carregarPerfis();
  marcarAlterado(false);
}
async function salvar() {
  roteiro.nome = $('#nome-roteiro').value.trim() || 'Sem nome';
  await api('/api/roteiros/' + encodeURIComponent(arquivo), { method: 'PUT', body: roteiro });
  marcarAlterado(false);
  const sel = $('#lista-roteiros');
  const opt = [...sel.options].find((o) => o.value === arquivo);
  if (opt) opt.textContent = roteiro.nome;
}
async function novo(nome, base) {
  const { arquivo: arq } = await api('/api/novo-arquivo', { method: 'POST', body: { nome } });
  const r = base ? { ...JSON.parse(JSON.stringify(base)), nome } : { nome, passos: [{ acao: 'abrir', url: 'https://', legenda: '' }], config: { ...PADRAO } };
  await api('/api/roteiros/' + encodeURIComponent(arq), { method: 'PUT', body: r });
  await carregarLista(arq);
}

// ---------------- passos ----------------
function renderTudo() {
  $('#nome-roteiro').value = roteiro.nome || '';
  renderPassos();
  renderConfig();
}
function renderPassos() {
  const ol = $('#passos');
  ol.innerHTML = '';
  const tpl = $('#tpl-passo');
  roteiro.passos.forEach((p, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.i = i;
    $('.num', li).textContent = i + 1;
    const sel = $('.acao', li);
    sel.innerHTML = Object.entries(ACOES).map(([k, a]) => `<option value="${k}">${a.rotulo}</option>`).join('');
    sel.value = p.acao;
    sel.onchange = () => { p.acao = sel.value; marcarAlterado(); renderPassos(); };
    const def = ACOES[p.acao] || ACOES.clicar;
    const campos = $('.p-campos', li);
    for (const [chave, rot, ph, tam] of def.campos) {
      const lab = document.createElement('label');
      if (tam) lab.className = tam;
      lab.textContent = rot;
      const inp = document.createElement('input');
      inp.value = p[chave] ?? '';
      inp.placeholder = ph;
      inp.dataset.chave = chave;
      inp.oninput = () => {
        p[chave] = inp.value;
        if (chave === 'alvo') {
          delete p.conferir;
          const b = inp.closest('.passo')?.querySelector('.borrar');
          if (b && p.borrar === undefined) b.checked = vaiBorrar(p);
        }
        marcarAlterado();
      };
      if (chave === 'alvo' && p.acao !== 'aguardar') {
        const linha = document.createElement('div');
        linha.className = 'alvo-linha';
        const b = document.createElement('button');
        b.className = 'apontar';
        b.type = 'button';
        b.textContent = '🎯 Apontar';
        b.title = 'Abre o site e você clica no elemento — o alvo é preenchido sozinho';
        b.onclick = (ev) => { ev.preventDefault(); apontarPasso(i); };
        linha.append(inp, b);
        lab.appendChild(linha);
        if (p.conferir) {
          const c = document.createElement('span');
          c.className = 'conferir';
          c.textContent = 'confira com "Testar"';
          lab.firstChild.after(c);
        }
      } else lab.appendChild(inp);
      campos.appendChild(lab);
    }
    const pn = $('.p-narr', li);
    const nar = $('.narracao', li);
    pn.hidden = !roteiro.config.narracaoAtiva || ['esperar'].includes(p.acao);
    nar.value = p.narracao || '';
    nar.oninput = () => { p.narracao = nar.value; marcarAlterado(); };
    const leg = $('.legenda', li);
    leg.value = p.legenda || '';
    leg.oninput = () => { p.legenda = leg.value; marcarAlterado(); };
    const fsel = $('.formatos', li);
    fsel.value = p.formatos || '';
    fsel.classList.toggle('ativo', !!p.formatos);
    fsel.onchange = () => { if (fsel.value) p.formatos = fsel.value; else delete p.formatos; fsel.classList.toggle('ativo', !!p.formatos); marcarAlterado(); };
    const bc = $('.borrar-chk', li);
    if (p.acao === 'digitar' || p.acao === 'selecionar') {
      const b = $('.borrar', li);
      b.checked = vaiBorrar(p);
      b.onchange = () => { p.borrar = b.checked; marcarAlterado(); };
    } else bc.style.display = 'none';
    const zc = $('.zoom-chk', li);
    if (def.zoom) {
      const z = $('.zoom', li);
      z.checked = p.zoom !== false;
      z.onchange = () => { p.zoom = z.checked; marcarAlterado(); };
    } else zc.style.display = 'none';
    $$('.ic', li).forEach((b) => (b.onclick = () => operar(i, b.dataset.op)));
    ol.appendChild(li);
  });
}
function operar(i, op) {
  const ps = roteiro.passos;
  if (op === 'subir' && i > 0) [ps[i - 1], ps[i]] = [ps[i], ps[i - 1]];
  if (op === 'descer' && i < ps.length - 1) [ps[i + 1], ps[i]] = [ps[i], ps[i + 1]];
  if (op === 'duplicar') ps.splice(i + 1, 0, JSON.parse(JSON.stringify(ps[i])));
  if (op === 'remover') ps.splice(i, 1);
  marcarAlterado();
  renderPassos();
}
function adicionar(acao) {
  roteiro.passos.push({ acao, legenda: '' });
  marcarAlterado();
  renderPassos();
  const ult = $('#passos').lastElementChild;
  ult.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const inp = $('.p-campos input', ult);
  if (inp) inp.focus();
}

// ---------------- configurações ----------------
function renderConfig() {
  const c = roteiro.config;
  $$('[data-cfg]').forEach((el) => {
    const k = el.dataset.cfg;
    if (el.classList.contains('seg')) {
      $$('button', el).forEach((b) => {
        b.classList.toggle('on', String(c[k]) === b.dataset.v);
        b.onclick = (ev) => { ev.preventDefault(); c[k] = ['fps', 'gifLargura'].includes(k) ? Number(b.dataset.v) : b.dataset.v; marcarAlterado(); renderConfig(); };
      });
    } else if (el.type === 'checkbox') {
      el.checked = !!c[k];
      el.onchange = () => { c[k] = el.checked; marcarAlterado(); atualizarSecoes(); if (k === 'narracaoAtiva') renderPassos(); };
    } else if (el.type === 'text') {
      el.value = c[k] ?? '';
      el.oninput = () => { c[k] = el.value; marcarAlterado(); };
    } else if (el.type === 'number') {
      el.value = c[k] ?? '';
      el.oninput = () => { const v = parseFloat(el.value); if (Number.isFinite(v)) { c[k] = v; marcarAlterado(); } };
    } else if (el.type === 'range') {
      el.value = c[k];
      el.oninput = () => { c[k] = Number(el.value); marcarAlterado(); rotulosRange(); };
    } else if (el.tagName === 'TEXTAREA') {
      el.value = c[k] || '';
      el.oninput = () => { c[k] = el.value; marcarAlterado(); };
    } else if (el.tagName === 'SELECT') {
      el.value = c[k] || '';
      el.onchange = () => { c[k] = el.value; marcarAlterado(); };
    }
  });
  rotulosRange();
  atualizarRemontar();
  atualizarSecoes();
  const cores = $('#cores');
  cores.innerHTML = '';
  for (const [nome, grad] of Object.entries(FUNDOS)) {
    const b = document.createElement('button');
    b.className = 'cor' + (c.fundo === nome ? ' on' : '');
    b.style.background = grad;
    b.title = nome;
    b.onclick = (ev) => { ev.preventDefault(); c.fundo = nome; marcarAlterado(); renderConfig(); };
    cores.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.title = 'Cor personalizada';
  custom.value = /^#/.test(c.fundo) ? c.fundo : '#6b2fa0';
  custom.oninput = () => { c.fundo = custom.value; marcarAlterado(); };
  cores.appendChild(custom);
}
// selos "ligado" nos títulos e subseções que só aparecem quando a opção está ligada
function atualizarSecoes() {
  const c = roteiro.config;
  $$('[data-tag]').forEach((t) => (t.hidden = !t.dataset.tag.split(',').some((k) => !!c[k])));
  $$('[data-mostrar]').forEach((d) => (d.hidden = !c[d.dataset.mostrar]));
}
function rotulosRange() {
  const c = roteiro.config;
  const v = Number(c.narracaoVelocidade) || 0;
  $('#velfala-v').textContent = v === 0 ? 'normal' : (v > 0 ? '+' : '') + v + '%';
  $('#volfala-v').textContent = Math.round((Number(c.volumeNarracao) || 1) * 100) + '%';
  $('#logotam-v').textContent = (Number(c.logoTamanho) || 12) + '% da largura';
  $('#logoop-v').textContent = Math.round((Number(c.logoOpacidade) || 0.85) * 100) + '%';
  const z = Number(roteiro.config.zoom);
  $('#zoom-v').textContent = z <= 1.01 ? 'desligado' : z.toFixed(1) + 'x';
  $('#vol-v').textContent = Math.round(Number(roteiro.config.volumeMusica) * 100) + '%';
}
async function carregarMusicas() {
  const m = await api('/api/musicas');
  $('#musicas').innerHTML = '<option value="">Sem música</option>' + m.map((f) => `<option>${esc(f)}</option>`).join('');
  if (roteiro) $('#musicas').value = roteiro.config.musica || '';
}
async function carregarVideos() {
  const v = await api('/api/videos');
  $('#videos').innerHTML = v.length ? v.map((x) => `<li><a href="${x.url}" data-video="${x.url}">${esc(x.nome)}</a></li>`).join('') : '<li><small>Nenhum vídeo ainda.</small></li>';
  $$('#videos a').forEach((a) => (a.onclick = (e) => { e.preventDefault(); mostrarVideo(a.dataset.video, a.textContent); }));
}
function mostrarVideo(url, nome, extras) {
  $('#resultado').hidden = false;
  const ex = extras || ((estado.videos || []).find((v) => v.url === url) || {}).extras || {};
  const rot = { capa: '🖼 Capa', gif: '🎞 GIF', srt: '💬 Legendas .srt' };
  $('#res-extras').innerHTML = Object.entries(ex).map(([k, u]) => `<a class="sec" href="${u}" target="_blank" download>${rot[k] || k}</a>`).join('');
  $('#video').src = url;
  $('#btn-baixar').href = url;
  $('#btn-baixar').setAttribute('download', nome || 'video.mp4');
}

// ---------------- apontar no site ----------------
async function apontarPasso(i) {
  if (estado.ocupado) return;
  await salvar();
  $$('.passo').forEach((li) => li.classList.remove('apontando'));
  $(`.passo[data-i="${i}"]`)?.classList.add('apontando');
  try {
    const r = await api('/api/apontar', { method: 'POST', body: { roteiro, indice: i } });
    const p = roteiro.passos[i];
    p.alvo = r.alvo;
    if (r.conferir) p.conferir = true; else delete p.conferir;
    if (r.campoTexto && (p.acao === 'clicar' || !p.acao)) p.acao = 'digitar';
    if (r.select && (p.acao === 'clicar' || !p.acao)) p.acao = 'selecionar';
    marcarAlterado();
    renderPassos();
    await salvar();
    const li = $(`.passo[data-i="${i}"]`);
    li?.classList.add('apontando');
    setTimeout(() => li?.classList.remove('apontando'), 1800);
    const texto = li && $('input[data-chave="texto"]', li);
    if (texto && !texto.value) texto.focus();
  } catch (e) {
    $$('.passo').forEach((li) => li.classList.remove('apontando'));
    if (!/Cancelado/.test(e.message)) mostrarErroLocal(e.message);
  }
}

// ---------------- criar passos navegando ----------------
async function navegar() {
  if (estado.ocupado) return;
  const primeiro = roteiro.passos.find((p) => p.acao === 'abrir' && p.url && p.url.length > 8);
  const url = prompt('Endereço do site onde você vai navegar:', primeiro ? primeiro.url : 'https://');
  if (!url) return;
  await salvar();
  try { await api('/api/capturar', { method: 'POST', body: { url, config: roteiro.config } }); }
  catch (e) { mostrarErroLocal(e.message); }
}
function descreverPasso(p) {
  const a = ACOES[p.acao] ? ACOES[p.acao].rotulo : p.acao;
  if (p.acao === 'abrir') return `${a}: ${p.url}`;
  if (p.acao === 'digitar') return `${a} "${p.senha ? '••••' : p.texto}" em "${p.alvo}"`;
  if (p.acao === 'selecionar') return `${a} "${p.texto}" em "${p.alvo}"`;
  if (p.acao === 'tecla') return `${a} ${p.tecla}`;
  return `${a} "${p.alvo}"`;
}
async function usarCaptura(modo) {
  const cap = (estado.captura || []).map(({ senha, ...p }) => p);
  if (modo === 'substituir') {
    if (roteiro.passos.length > 1 && !confirm('Isso troca todos os passos atuais pelos passos anotados. Continuar?')) return false;
    roteiro.passos = cap;
    if (roteiro.passos[0]) roteiro.passos[0].legenda = roteiro.passos[0].legenda || '';
  } else if (modo === 'adicionar') {
    const semAbrirInicial = cap[0] && cap[0].acao === 'abrir' && roteiro.passos.length ? cap.slice(1) : cap;
    roteiro.passos.push(...semAbrirInicial);
  }
  if (modo !== 'descartar') {
    const temSenha = (estado.captura || []).some((p) => p.senha);
    marcarAlterado();
    renderPassos();
    await salvar();
    if (temSenha) alert('Atenção: um dos passos digita uma senha e ela ficou salva no roteiro. Use um usuário de teste.');
  }
  await api('/api/capturar/limpar', { method: 'POST' });
  return modo !== 'descartar';
}

// ---------------- execução ----------------
function validar() {
  const erros = [];
  roteiro.passos.forEach((p, i) => {
    const def = ACOES[p.acao];
    if (!def) return erros.push(`Passo ${i + 1}: ação inválida.`);
    if (p.acao === 'abrir' && !(p.url || '').replace(/^https?:\/\/?/, '').trim()) erros.push(`Passo ${i + 1}: falta o endereço.`);
    if (['clicar', 'digitar', 'selecionar', 'passar', 'aguardar'].includes(p.acao) && !(p.alvo || '').trim()) erros.push(`Passo ${i + 1}: falta o alvo.`);
  });
  if (!roteiro.passos.length) erros.push('Adicione pelo menos um passo.');
  if (roteiro.passos[0] && roteiro.passos[0].acao !== 'abrir') erros.push('O primeiro passo deve ser "Abrir página".');
  return erros;
}
async function executar(modo) {
  const erros = validar();
  if (erros.length) { mostrarErroLocal(erros.join('\n')); return; }
  await salvar();
  try { await api('/api/executar', { method: 'POST', body: { roteiro, modo } }); }
  catch (e) { mostrarErroLocal(e.message); }
}
async function remontar(previa = false) {
  await salvar();
  try { await api('/api/renderizar', { method: 'POST', body: { roteiro, previa } }); }
  catch (e) { mostrarErroLocal(e.message); }
}
// ---------------- aviso quando um trabalho termina ----------------
let tituloOriginal = document.title;
function avisarFim(antes, s) {
  if (!antes.ocupado || s.ocupado) return;
  let icone, titulo, texto, tipo;
  if (s.fase === 'erro') { icone = '⚠️'; tipo = 'erro'; titulo = 'Parou com erro'; texto = s.erro || s.mensagem; }
  else if (s.fase === 'parado') { icone = '■'; tipo = 'neutro'; titulo = 'Parado'; texto = s.mensagem; }
  else if (s.fase === 'testado') { icone = '✅'; tipo = 'ok'; titulo = 'Teste concluído'; texto = 'Todos os passos funcionaram. Pode gravar o vídeo.'; }
  else if (s.fase === 'pronto') { abrirVideo(s); return; }
  else return;
  const a = $('#aviso-final');
  a.className = 'aviso-final ' + tipo;
  $('#aviso-final-icone').textContent = icone;
  $('#aviso-final-titulo').textContent = titulo;
  $('#aviso-final-texto').textContent = texto;
  a.hidden = false;
  clearTimeout(avisarFim.t);
  if (tipo === 'ok') avisarFim.t = setTimeout(() => (a.hidden = true), 9000);
  if (s.erroIndice != null) setTimeout(() => $(`.passo[data-i="${s.erroIndice}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  // avisa também na aba do navegador, se o painel estiver em segundo plano
  if (document.hidden) {
    document.title = `${icone} ${titulo} — ClickReel`;
    document.addEventListener('visibilitychange', () => (document.title = tituloOriginal), { once: true });
  }
}
$('#aviso-final-fechar').onclick = () => ($('#aviso-final').hidden = true);

// janela grande com o vídeo tocando assim que fica pronto
function abrirVideo(s) {
  const v = (s.videos || []).slice(-1)[0];
  const url = s.video || (v && v.url);
  if (!url) return;
  const previa = /\/previa-/.test(url);
  $('#dv-titulo').textContent = previa ? '👁 Prévia pronta' : (s.videos || []).length > 1 ? `🎬 ${s.videos.length} vídeos prontos` : '🎬 Vídeo pronto';
  $('#dv-dica').textContent = previa
    ? 'A prévia é leve (baixa resolução) só para conferir. Gostou? Grave em alta qualidade.'
    : (s.videos || []).length > 1 ? 'Os outros formatos estão nas abas à direita e na pasta "videos".' : 'O vídeo também está na pasta "videos".';
  const p = $('#dv-player');
  p.src = url;
  p.play().catch(() => {});
  $('#dv-baixar').href = url;
  $('#dv-baixar').setAttribute('download', (url.split('/').pop() || 'video.mp4').split('?')[0]);
  $('#dv-gravar').hidden = !previa;
  const ex = (v && v.extras) || {};
  const rot = { capa: '🖼 Capa', gif: '🎞 GIF', srt: '💬 Legendas' };
  $('#dv-extras').innerHTML = Object.entries(ex).map(([k, u]) => `<a class="sec" href="${u}" target="_blank" download>${rot[k] || k}</a>`).join('');
  if (!$('#dlg-video').open) $('#dlg-video').showModal();
}
const fecharVideo = () => { $('#dv-player').pause(); $('#dlg-video').close(); };
$('#dv-fechar').onclick = fecharVideo;
$('#dv-ok').onclick = fecharVideo;
$('#dlg-video').addEventListener('close', () => $('#dv-player').pause());
$('#dv-gravar').onclick = () => { fecharVideo(); executar('gravar'); };

const NOMES_FORMATO = { horizontal: 'Desktop', tablet: 'Tablet em pé', 'tablet-deitado': 'Tablet deitado', vertical: 'Celular' };
function atualizarRemontar() {
  if (!roteiro) return;
  const f = roteiro.config.formato;
  const tem = estado.ultimas && estado.ultimas[f];
  $('#btn-remontar').hidden = !tem;
  $('#btn-remontar-previa').hidden = !tem;
  $('#btn-remontar').textContent = `↻ Remontar a última gravação (${NOMES_FORMATO[f]}) com estes efeitos`;
  const dicas = {
    horizontal: 'Vídeo 16:9 com janela de navegador.',
    tablet: 'Site aberto como iPad; vídeo vertical 9:16.',
    'tablet-deitado': 'Site aberto como iPad deitado; vídeo 16:9.',
    vertical: 'Site aberto como iPhone; vídeo vertical 9:16 (Reels/Stories).'
  };
  $('#dica-formato').textContent = dicas[f] || '';
  const c = roteiro.config;
  const tam = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] }[c.resolucao] || [1920, 1080];
  const vert = f === 'vertical' || f === 'tablet';
  $('#dica-resolucao').textContent = `Vídeo final: ${vert ? tam[1] : tam[0]}×${vert ? tam[0] : tam[1]}.` +
    (c.formato === 'horizontal' && c.telaDesktop === '1920x1080' && c.resolucao === '1080p' ? ' Com tela 1920×1080, use 1440p ou 4K para o texto do site não ficar miúdo.' : '') +
    (c.resolucao === '4k' ? ' 4K demora mais para montar.' : '');
}
function mostrarErroLocal(msg) {
  $('#st-erro').hidden = false;
  $('#st-erro').textContent = msg;
}

const NOMES_FASE = { parado: 'Parado', gravando: 'Gravando', testando: 'Testando', renderizando: 'Montando', pronto: 'Pronto', testado: 'Teste ok', erro: 'Erro', apontando: 'Apontando', navegando: 'Anotando', capturado: 'Passos anotados', login: 'Login' };
function aplicarEstado(s) {
  const antes = estado;
  estado = s;
  $('#st-fase').textContent = NOMES_FASE[s.fase] || s.fase;
  $('#st-fase').className = 'fase ' + s.fase;
  $('#st-msg').textContent = s.mensagem || '';
  const pct = s.fase === 'apontando' || s.fase === 'navegando' ? 0 : s.fase === 'renderizando' ? s.pct : (s.fase === 'gravando' || s.fase === 'testando') && s.total ? Math.round((s.passo / s.total) * 100) : s.fase === 'pronto' || s.fase === 'testado' ? 100 : 0;
  $('#st-barra').style.width = pct + '%';
  $('#st-erro').hidden = !s.erro;
  $('#st-erro').textContent = s.erro || '';
  $('#st-erro-img').hidden = !s.erroImagem;
  if (s.erroImagem) $('#st-erro-img').src = s.erroImagem + '?' + Date.now();
  $('#btn-cancelar').hidden = !s.ocupado || s.fase === 'navegando';
  const podePausar = s.ocupado && (s.fase === 'gravando' || s.fase === 'testando');
  $('#btn-pausar').hidden = !podePausar;
  $('#btn-pausar').textContent = s.pausado ? '▶ Continuar' : '❚❚ Pausar';
  $('#btn-pausar').classList.toggle('pri', !!s.pausado);
  $('#btn-pausar').classList.toggle('sec', !s.pausado);
  if (s.pausado && podePausar) $('#st-fase').textContent = 'Pausado';
  avisarFim(antes, s);
  $('#btn-terminar').hidden = s.fase !== 'navegando';
  ['#btn-gravar', '#btn-testar', '#btn-remontar', '#btn-remontar-previa', '#btn-todos', '#btn-navegar', '#btn-navegar-topo', '#btn-previa', '#btn-fila', '#perfil-novo', '#perfil-entrar'].forEach((b) => ($(b).disabled = !!s.ocupado));
  $$('.apontar').forEach((b) => (b.disabled = !!s.ocupado));
  atualizarRemontar();
  // destaca o passo em execução / com erro
  $$('.passo').forEach((li) => li.classList.remove('atual', 'falhou'));
  if ((s.fase === 'gravando' || s.fase === 'testando') && s.indice != null) $(`.passo[data-i="${s.indice}"]`)?.classList.add('atual');
  if ((s.fase === 'erro' || s.fase === 'parado') && s.erroIndice != null) $(`.passo[data-i="${s.erroIndice}"]`)?.classList.add(s.fase === 'erro' ? 'falhou' : 'atual');
  // mantém à vista o passo que está rodando
  if ((s.fase === 'gravando' || s.fase === 'testando') && s.indice != null && s.indice !== antes.indice) {
    $(`.passo[data-i="${s.indice}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // passos anotados navegando
  const cap = s.captura && s.captura.length;
  $('#captura').hidden = !cap;
  if (cap) {
    $('#captura-titulo').textContent = s.fase === 'navegando' ? `Anotando… (${s.captura.length} passos)` : `${s.captura.length} passos anotados`;
    $('#captura-lista').innerHTML = s.captura.map((p) => `<li>${esc(descreverPasso(p))}${p.conferir ? ' <span class="conferir">conferir</span>' : ''}</li>`).join('');
    $('#captura-acoes').hidden = s.fase !== 'capturado';
    const l = $('#captura-lista'); l.scrollTop = l.scrollHeight;
  }
  // vídeos prontos (um ou vários formatos)
  const lista = s.videos || [];
  if (s.video && antes.video !== s.video) { mostrarVideo(s.video, s.videoNome); carregarVideos(); }
  if (s.fila && s.ocupado) $('#st-fase').textContent = `Fila ${s.fila.atual}/${s.fila.total}`;
  if (antes.fase === 'login' && s.fase !== 'login') carregarPerfis();
  const abas = $('#res-abas');
  abas.innerHTML = lista.length > 1 ? lista.map((v) => `<button data-url="${v.url}" data-nome="${esc(v.nome)}" class="${v.url === $('#video').getAttribute('src') ? 'on' : ''}">${esc(v.formato)}</button>`).join('') : '';
  $$('button', abas).forEach((b) => (b.onclick = () => { mostrarVideo(b.dataset.url, b.dataset.nome); aplicarEstado(estado); }));
}
function conectarEventos() {
  const es = new EventSource('/api/eventos');
  es.onmessage = (e) => aplicarEstado(JSON.parse(e.data));
  es.onerror = () => { $('#st-msg').textContent = 'Sem conexão com o ClickReel. A janela preta do programa ainda está aberta?'; };
}

// ---------------- util ----------------
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

// ---------------- tema claro / escuro ----------------
const TEMAS = { auto: ['🌓', 'automático (segue o Windows)'], escuro: ['🌙', 'escuro'], claro: ['☀️', 'claro'] };
function temaAtual() { return document.documentElement.dataset.tema || 'auto'; }
function aplicarTema(t) {
  if (t === 'auto') delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = t;
  localStorageSet('tema', t === 'auto' ? '' : t);
  const [icone, nome] = TEMAS[t];
  $('#btn-tema').textContent = icone;
  $('#btn-tema').title = `Tema: ${nome}. Clique para trocar.`;
}
$('#btn-tema').onclick = () => {
  const ordem = ['auto', 'escuro', 'claro'];
  aplicarTema(ordem[(ordem.indexOf(temaAtual()) + 1) % ordem.length]);
};
aplicarTema(temaAtual());

// ---------------- ligações ----------------
$('#lista-roteiros').onchange = async (e) => {
  if (alterado && !confirm('Há alterações não salvas. Trocar de roteiro mesmo assim?')) { e.target.value = arquivo; return; }
  await abrir(e.target.value);
};
$('#btn-novo').onclick = () => { const n = prompt('Nome do novo roteiro:', 'Nova demonstração'); if (n) novo(n); };
$('#btn-duplicar').onclick = () => { const n = prompt('Nome da cópia:', (roteiro.nome || '') + ' (cópia)'); if (n) novo(n, roteiro); };
$('#btn-excluir').onclick = async () => {
  if (!confirm(`Excluir o roteiro "${roteiro.nome}"?`)) return;
  await api('/api/roteiros/' + encodeURIComponent(arquivo), { method: 'DELETE' });
  localStorageSet('ultimoRoteiro', '');
  await carregarLista();
};
$('#btn-salvar').onclick = salvar;
$('#btn-testar').onclick = () => executar('testar');
$('#btn-gravar').onclick = () => executar('gravar');
$('#btn-todos').onclick = () => executar('todos');
$('#btn-navegar').onclick = navegar;
$('#btn-navegar-topo').onclick = navegar;
$('#cap-gravar').onclick = async () => {
  if (await usarCaptura('substituir')) {
    // dá um instante para o servidor liberar e grava no formato escolhido
    setTimeout(() => executar('gravar'), 300);
  }
};
$('#btn-terminar').onclick = () => api('/api/capturar/parar', { method: 'POST' });
$('#cap-substituir').onclick = () => usarCaptura('substituir');
$('#cap-adicionar').onclick = () => usarCaptura('adicionar');
$('#cap-descartar').onclick = () => usarCaptura('descartar');
$('#btn-remontar').onclick = remontar;
$('#btn-cancelar').onclick = () => api('/api/cancelar', { method: 'POST' });
$('#btn-pausar').onclick = () => api('/api/pausar', { method: 'POST' }).catch((e) => mostrarErroLocal(e.message));
$('#btn-pasta').onclick = () => api('/api/abrir-pasta', { method: 'POST' });
$('#btn-pasta-musicas').onclick = (e) => { e.preventDefault(); api('/api/abrir-pasta-musicas', { method: 'POST' }); setTimeout(carregarMusicas, 4000); };
$('#musicas').onfocus = carregarMusicas;
$('#btn-ajuda').onclick = () => { $('#ajuda').hidden = !$('#ajuda').hidden; };
$('#nome-roteiro').oninput = () => marcarAlterado();
$$('[data-add]').forEach((b) => (b.onclick = () => adicionar(b.dataset.add)));
$('#add-outro').onchange = (e) => { if (e.target.value) adicionar(e.target.value); e.target.value = ''; };
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); salvar(); } });
window.addEventListener('beforeunload', (e) => { if (alterado) { e.preventDefault(); e.returnValue = ''; } });

// ---------------- prévia, fila ----------------
$('#btn-previa').onclick = () => executar('previa');
$('#btn-remontar-previa').onclick = () => remontar(true);
$('#btn-fila').onclick = async () => {
  const lista = await api('/api/roteiros');
  $('#fila-lista').innerHTML = lista.map((r) => `<label><input type="checkbox" value="${esc(r.arquivo)}" ${r.arquivo === arquivo ? 'checked' : ''}> ${esc(r.nome)}</label>`).join('');
  $('#dlg-fila').showModal();
};
$$('#fila-modo button').forEach((b) => (b.onclick = (e) => { e.preventDefault(); $$('#fila-modo button').forEach((x) => x.classList.toggle('on', x === b)); }));
$('#fila-fechar').onclick = () => $('#dlg-fila').close();
$('#fila-iniciar').onclick = async () => {
  const arquivos = $$('#fila-lista input:checked').map((i) => i.value);
  if (!arquivos.length) return alert('Marque pelo menos um roteiro.');
  if (alterado) await salvar();
  const modo = $('#fila-modo button.on').dataset.v;
  $('#dlg-fila').close();
  try { await api('/api/fila', { method: 'POST', body: { arquivos, modo } }); } catch (e) { mostrarErroLocal(e.message); }
};

// ---------------- logo ----------------
async function carregarLogo() {
  const { tem } = await api('/api/logo');
  $('#logo-prev').innerHTML = tem ? `<img src="/logo?${Date.now()}" alt="logo">` : '<span>sem logo</span>';
  $('#logo-remover').disabled = !tem;
}
$('#logo-arquivo').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5e6) return alert('Imagem muito grande (máx. 5 MB).');
  const r = new FileReader();
  r.onload = async () => {
    try {
      await api('/api/logo', { method: 'POST', body: { dataUrl: r.result } });
      await carregarLogo();
      if (!roteiro.config.logo) { roteiro.config.logo = true; marcarAlterado(); renderConfig(); }
    } catch (err) { alert(err.message); }
  };
  r.readAsDataURL(f);
  e.target.value = '';
};
$('#logo-remover').onclick = async () => { if (confirm('Remover o logo?')) { await api('/api/logo', { method: 'DELETE' }); carregarLogo(); } };

// ---------------- vozes da narração ----------------
async function carregarVozes() {
  const v = await api('/api/vozes');
  $('#vozes').innerHTML = Object.entries(v).map(([id, nome]) => `<option value="${id}">${esc(nome)}</option>`).join('');
  if (roteiro) $('#vozes').value = roteiro.config.narracaoVoz || 'pt-BR-FranciscaNeural';
}

// ---------------- login lembrado ----------------
async function carregarPerfis() {
  const p = await api('/api/perfis');
  const atual = roteiro ? roteiro.config.perfil || '' : '';
  const ops = ['<option value="">Sem login (navegador limpo)</option>'].concat(p.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`));
  if (atual && !p.includes(atual)) ops.push(`<option value="${esc(atual)}">${esc(atual)} (ainda não criado)</option>`);
  $('#perfis').innerHTML = ops.join('');
  $('#perfis').value = atual;
  $('#perfil-entrar').disabled = !atual || estado.ocupado;
  $('#perfil-apagar').disabled = !atual || estado.ocupado;
}
$('#perfis').addEventListener('change', () => carregarPerfis());
async function entrarPerfil(nome) {
  const primeiro = roteiro.passos.find((p) => p.acao === 'abrir' && p.url && p.url.length > 8);
  const url = prompt('Endereço da página de login:', primeiro ? primeiro.url : 'https://');
  if (!url) return;
  try {
    const r = await api('/api/perfis/entrar', { method: 'POST', body: { perfil: nome, url, config: roteiro.config } });
    roteiro.config.perfil = r.perfil;
    marcarAlterado();
    await salvar();
    await carregarPerfis();
  } catch (e) { mostrarErroLocal(e.message); }
}
$('#perfil-novo').onclick = () => { const n = prompt('Nome para este login (ex.: loja-cliente, wordpress-admin):', 'loja-cliente'); if (n) entrarPerfil(n); };
$('#perfil-entrar').onclick = () => { if (roteiro.config.perfil) entrarPerfil(roteiro.config.perfil); };
$('#perfil-apagar').onclick = async () => {
  const n = roteiro.config.perfil;
  if (!n || !confirm(`Esquecer o login "${n}"? Você terá que entrar de novo para usá-lo.`)) return;
  await api('/api/perfis/apagar', { method: 'POST', body: { perfil: n } });
  roteiro.config.perfil = '';
  marcarAlterado(); await salvar(); renderConfig(); carregarPerfis();
};

// ---------------- atualização ----------------
async function checarVersao(forcar = false) {
  try {
    const prefs = await api('/api/preferencias');
    $('#pref-atualizacoes').checked = prefs.checarAtualizacoes !== false;
    $('#versao-atual').textContent = `Versão instalada: ${prefs.versao}`;
    if (prefs.checarAtualizacoes === false && !forcar) return;
    const a = await api('/api/atualizacao' + (forcar ? '?forcar=1' : ''));
    const fechada = localStorageGet('versaoFechada') === a.nova;
    $('#aviso-versao').hidden = !a.nova || (fechada && !forcar);
    if (a.nova) { $('#nova-versao').textContent = a.nova; $('#link-versao').href = a.url; }
    if (forcar) $('#versao-atual').textContent = a.nova ? `Versão ${a.nova} disponível (instalada: ${a.atual})` : `Você está na versão mais nova (${a.atual}).`;
  } catch (_) { if (forcar) $('#versao-atual').textContent = 'Não consegui verificar agora (sem internet?).'; }
}
$('#pref-atualizacoes').onchange = async (e) => { await api('/api/preferencias', { method: 'PUT', body: { checarAtualizacoes: e.target.checked } }); if (e.target.checked) checarVersao(); };
$('#btn-ver-atualizacao').onclick = () => checarVersao(true);
$('#fechar-versao').onclick = () => { localStorageSet('versaoFechada', $('#nova-versao').textContent); $('#aviso-versao').hidden = true; };

// seções abertas/fechadas são lembradas
$$('details.secao').forEach((d) => {
  const k = 'secao-' + d.dataset.secao;
  const v = localStorageGet(k);
  if (v === '1') d.open = true; else if (v === '0') d.open = false;
  d.addEventListener('toggle', () => localStorageSet(k, d.open ? '1' : '0'));
});

(async function iniciar() {
  try { PADRAO = { ...PADRAO, ...(await api('/api/padrao')) }; } catch (_) {}
  await carregarVozes();
  await carregarMusicas();
  await carregarLista();
  await carregarMusicas();
  await carregarVozes();
  await carregarPerfis();
  carregarLogo();
  carregarVideos();
  conectarEventos();
  checarVersao();
})();
