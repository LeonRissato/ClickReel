// Encontra elementos na página a partir do "alvo" escrito pelo usuário
// (texto do botão, rótulo do campo, css: ..., texto: ..., "Comprar [2]").
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function localizadores(page, alvo) {
  const a = alvo.trim();
  if (/^css:/i.test(a)) return [page.locator(a.slice(4).trim())];
  if (/^texto:/i.test(a)) {
    const t = a.slice(6).trim();
    return [page.getByText(t, { exact: true }), page.getByText(t)];
  }
  const pareceCss = /^[#.\[]/.test(a) || /^[a-z][a-z0-9-]*[#.\[]/i.test(a) || /^[a-z]+\s*>\s*/i.test(a);
  if (pareceCss) return [page.locator(a)];
  return [
    page.getByRole('button', { name: a, exact: true }),
    page.getByRole('link', { name: a, exact: true }),
    page.getByLabel(a, { exact: true }),
    page.getByPlaceholder(a, { exact: true }),
    page.getByText(a, { exact: true }),
    page.getByRole('button', { name: a }),
    page.getByRole('link', { name: a }),
    page.getByLabel(a),
    page.getByPlaceholder(a),
    page.getByText(a)
  ];
}

function separarOrdem(alvoBruto) {
  let alvo = String(alvoBruto || '').trim();
  let ordem = 0;
  const m = alvo.match(/^(.*\S)\s*\[(\d+)\]$/);
  if (m) {
    alvo = m[1];
    ordem = Math.max(0, parseInt(m[2], 10) - 1);
  }
  return { alvo, ordem };
}

// Uma tentativa: devolve o elemento ou null
async function achar(page, alvoBruto) {
  const { alvo, ordem } = separarOrdem(alvoBruto);
  if (!alvo) return null;
  for (const c of localizadores(page, alvo)) {
    try {
      const n = await c.count();
      const visiveis = [];
      for (let i = 0; i < Math.min(n, 25); i++) {
        const el = c.nth(i);
        if (await el.isVisible()) visiveis.push(el);
        if (visiveis.length > ordem) return visiveis[ordem];
      }
    } catch (_) { /* seletor inválido ou página navegando: tenta o próximo */ }
  }
  return null;
}

async function localizar(page, alvoBruto, timeout = 15000) {
  if (!alvoBruto || !String(alvoBruto).trim()) throw new Error('Este passo precisa de um alvo (texto do botão, link ou campo).');
  const fim = Date.now() + timeout;
  while (true) {
    const el = await achar(page, alvoBruto);
    if (el) return el;
    if (Date.now() > fim) break;
    await sleep(250);
  }
  throw new Error(`Não encontrei na página: "${alvoBruto}". Confira se o texto está igual ao do site (ou use "Apontar no site").`);
}

// Recebe sugestões de alvo geradas na página para o elemento marcado com
// data-estudio-alvo="<id>" e devolve a primeira que realmente encontra ESSE elemento.
async function escolherAlvo(page, sugestoes, id) {
  for (const s of sugestoes || []) {
    for (let k = 1; k <= 6; k++) {
      const cand = k === 1 ? s : `${s} [${k}]`;
      const el = await achar(page, cand).catch(() => null);
      if (!el) break;
      const ok = await el
        .evaluate((e, id) => {
          const m = document.querySelector(`[data-estudio-alvo~="${id}"]`);
          return !!m && (e === m || m.contains(e) || (e.contains(m) && e.tagName !== 'BODY' && e.tagName !== 'HTML'));
        }, id)
        .catch(() => false);
      if (ok) return cand;
    }
  }
  return null;
}

module.exports = { achar, localizar, escolherAlvo };
