// Painel do ClickReel
const ACOES = {
  abrir: { rotulo: 'Abrir página', campos: [['url', 'Endereço', 'https://seusite.com.br/produto']] },
  clicar: { rotulo: 'Clicar', campos: [['alvo', 'Alvo (texto do botão, link…)', 'Adicionar ao carrinho']], zoom: true },
  digitar: { rotulo: 'Digitar', campos: [['alvo', 'Campo (rótulo ou placeholder)', 'E-mail'], ['texto', 'Texto a digitar', 'maria@exemplo.com']], zoom: true },
  selecionar: { rotulo: 'Escolher opção', campos: [['alvo', 'Lista (rótulo)', 'Estado'], ['texto', 'Opção', 'São Paulo']], zoom: true },
  passar: { rotulo: 'Passar o mouse', campos: [['alvo', 'Alvo', 'Menu Livros']], zoom: true },
  rolar: { rotulo: 'Rolar a página', campos: [['alvo', 'Até o elemento (opcional)', 'Descrição'], ['pixels', 'ou pixels', '600', 'curto']] },
  tecla: { rotulo: 'Apertar tecla', campos: [['tecla', 'Tecla', 'Enter', 'curto']] },
  aguardar: { rotulo: 'Aguardar aparecer', campos: [['alvo', 'Texto que deve aparecer', 'Pedido recebido']] },
  esperar: { rotulo: 'Pausa', campos: [['segundos', 'Segundos', '1.5', 'curto']] },
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
const PADRAO = { formato: 'horizontal', moldura: true, fundo: 'ameixa', zoom: 1.8, velocidade: 'normal', fps: 30, qualidade: 'alta', mostrarNavegador: false, acelerarCarregamentos: true, mostrarUrl: true, cursor: true, estiloLegenda: 'escuro', musica: '', volumeMusica: 0.5 };

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
      inp.oninput = () => { p[chave] = inp.value; if (chave === 'alvo') delete p.conferir; marcarAlterado(); };
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
    const leg = $('.legenda', li);
    leg.value = p.legenda || '';
    leg.oninput = () => { p.legenda = leg.value; marcarAlterado(); };
    const fsel = $('.formatos', li);
    fsel.value = p.formatos || '';
    fsel.classList.toggle('ativo', !!p.formatos);
    fsel.onchange = () => { if (fsel.value) p.formatos = fsel.value; else delete p.formatos; fsel.classList.toggle('ativo', !!p.formatos); marcarAlterado(); };
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
        b.onclick = (ev) => { ev.preventDefault(); c[k] = k === 'fps' ? Number(b.dataset.v) : b.dataset.v; marcarAlterado(); renderConfig(); };
      });
    } else if (el.type === 'checkbox') {
      el.checked = !!c[k];
      el.onchange = () => { c[k] = el.checked; marcarAlterado(); };
    } else if (el.type === 'range') {
      el.value = c[k];
      el.oninput = () => { c[k] = Number(el.value); marcarAlterado(); rotulosRange(); };
    } else if (el.tagName === 'SELECT') {
      el.value = c[k] || '';
      el.onchange = () => { c[k] = el.value; marcarAlterado(); };
    }
  });
  rotulosRange();
  atualizarRemontar();
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
function rotulosRange() {
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
function mostrarVideo(url, nome) {
  $('#resultado').hidden = false;
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
    if (roteiro.passos.length > 1 && !confirm('Isso troca todos os passos atuais pelos passos anotados. Continuar?')) return;
    roteiro.passos = cap;
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
async function remontar() {
  await salvar();
  try { await api('/api/renderizar', { method: 'POST', body: { roteiro } }); }
  catch (e) { mostrarErroLocal(e.message); }
}
const NOMES_FORMATO = { horizontal: 'Desktop', tablet: 'Tablet em pé', 'tablet-deitado': 'Tablet deitado', vertical: 'Celular' };
function atualizarRemontar() {
  if (!roteiro) return;
  const f = roteiro.config.formato;
  const tem = estado.ultimas && estado.ultimas[f];
  $('#btn-remontar').hidden = !tem;
  $('#btn-remontar').textContent = `↻ Remontar a última gravação (${NOMES_FORMATO[f]}) com estes efeitos`;
  const dicas = {
    horizontal: 'Vídeo 16:9 com janela de navegador.',
    tablet: 'Site aberto como iPad; vídeo vertical 9:16.',
    'tablet-deitado': 'Site aberto como iPad deitado; vídeo 16:9.',
    vertical: 'Site aberto como iPhone; vídeo vertical 9:16 (Reels/Stories).'
  };
  $('#dica-formato').textContent = dicas[f] || '';
}
function mostrarErroLocal(msg) {
  $('#st-erro').hidden = false;
  $('#st-erro').textContent = msg;
}

const NOMES_FASE = { parado: 'Parado', gravando: 'Gravando', testando: 'Testando', renderizando: 'Montando', pronto: 'Pronto', testado: 'Teste ok', erro: 'Erro', apontando: 'Apontando', navegando: 'Anotando', capturado: 'Passos anotados' };
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
  $('#btn-terminar').hidden = s.fase !== 'navegando';
  ['#btn-gravar', '#btn-testar', '#btn-remontar', '#btn-todos', '#btn-navegar'].forEach((b) => ($(b).disabled = !!s.ocupado));
  $$('.apontar').forEach((b) => (b.disabled = !!s.ocupado));
  atualizarRemontar();
  // destaca o passo em execução / com erro
  $$('.passo').forEach((li) => li.classList.remove('atual', 'falhou'));
  if ((s.fase === 'gravando' || s.fase === 'testando') && s.indice != null) $(`.passo[data-i="${s.indice}"]`)?.classList.add('atual');
  if (s.fase === 'erro' && s.erroIndice != null) $(`.passo[data-i="${s.erroIndice}"]`)?.classList.add('falhou');
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
$('#btn-terminar').onclick = () => api('/api/capturar/parar', { method: 'POST' });
$('#cap-substituir').onclick = () => usarCaptura('substituir');
$('#cap-adicionar').onclick = () => usarCaptura('adicionar');
$('#cap-descartar').onclick = () => usarCaptura('descartar');
$('#btn-remontar').onclick = remontar;
$('#btn-cancelar').onclick = () => api('/api/cancelar', { method: 'POST' });
$('#btn-pasta').onclick = () => api('/api/abrir-pasta', { method: 'POST' });
$('#btn-pasta-musicas').onclick = (e) => { e.preventDefault(); api('/api/abrir-pasta-musicas', { method: 'POST' }); setTimeout(carregarMusicas, 4000); };
$('#musicas').onfocus = carregarMusicas;
$('#btn-ajuda').onclick = () => { $('#ajuda').hidden = !$('#ajuda').hidden; };
$('#nome-roteiro').oninput = () => marcarAlterado();
$$('[data-add]').forEach((b) => (b.onclick = () => adicionar(b.dataset.add)));
$('#add-outro').onchange = (e) => { if (e.target.value) adicionar(e.target.value); e.target.value = ''; };
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); salvar(); } });
window.addEventListener('beforeunload', (e) => { if (alterado) { e.preventDefault(); e.returnValue = ''; } });

(async function iniciar() {
  await carregarMusicas();
  await carregarLista();
  await carregarMusicas();
  carregarVideos();
  conectarEventos();
})();
