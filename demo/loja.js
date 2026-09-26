const LIVROS={estrela:{t:'A Última Estrela',p:59.9,c:'c1'},mar:{t:'Canções do Mar Vermelho',p:49.9,c:'c2'},bosque:{t:'O Bosque das Horas',p:54.9,c:'c3'},mapa:{t:'O Mapa de Areia',p:44.9,c:'c4'}};
const real=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const carrinho=()=>JSON.parse(localStorage.getItem('carrinho')||'[]');
function topo(){document.write(`<header><a class="logo" href="index.html">Livraria Exemplo</a><nav><a href="index.html">Início</a><a href="index.html">Lançamentos</a><a href="index.html">Contato</a></nav><a class="carrinho-link" href="carrinho.html">Carrinho (${carrinho().length})</a></header>`)}
