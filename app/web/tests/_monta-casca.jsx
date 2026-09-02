// Entrada usada só pelo `navegacao.smoke.mjs`: renderiza a CASCA fora do navegador, com o papel e o
// caminho escolhidos, para provar que o menu desenhado obedece ao catálogo. Não vai para a imagem —
// é artefato de teste.
//
// ⚠️ `MemoryRouter` e não `BrowserRouter`: não há `window.history` aqui. É o roteador de verdade,
// só que com o histórico na memória — o que se mede continua sendo o componente de produção.
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Casca from '../src/componentes/Casca.jsx';

/** Uma tela de mentira no lugar da real: o que este teste mede é a CASCA (menu, cabeçalho, rodapé),
 *  e montar o editor de fluxo inteiro junto só acrescentaria ruído de 5.000 linhas ao HTML. */
function TelaDeMentira() {
  return <div data-tela="mentira">conteúdo da tela</div>;
}

// ⚠️ O React avisa «useLayoutEffect does nothing on the server» para CADA link do menu. É esperado
// e não é defeito nosso: o roteador é feito para o navegador, e aqui ele está sendo renderizado sem
// um. São ~15 blocos de aviso por renderização — e um teste cujo resultado se perde no meio do
// ruído é um teste que ninguém lê. Calo SÓ este aviso, e deixo passar todo o resto: silenciar o
// `console.error` inteiro esconderia o erro de verdade na próxima quebra.
const erroOriginal = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
  erroOriginal(...args);
};

export function renderizarCasca({ papel = 'user', caminho = '/fluxos', versao = null, empresa = null, aviso = null } = {}) {
  const ator = { id: 'cw:7', nome: papel === 'admin' ? 'Ana Administradora' : 'Bruno Atendente', papel, isSuperuser: false };
  return renderToString(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route element={<Casca ator={ator} empresa={empresa} versao={versao} aviso={aviso} />}>
          <Route path="*" element={<TelaDeMentira />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
