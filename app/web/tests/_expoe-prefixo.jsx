// Entrada usada só pelo `prefixo.smoke.mjs`. Empacotada em modo SSR com `RAGNABOT_PREFIXO_WEB`
// definido, ela devolve os valores JÁ RESOLVIDOS — o Vite troca `import.meta.env.BASE_URL` pelo
// literal na hora de construir, então o que o Node lê aqui é exatamente o que o navegador leria.
//
// ⚠️ POR QUE NÃO BASTA PROCURAR A CADEIA NO PACOTE DO NAVEGADOR (foi a minha primeira tentativa, e
// ela reprovou com razão): `caminhoDoApp('/api/ragnabot-fluxo')` é uma CHAMADA — o resultado só
// existe em tempo de execução, e nenhum minificador junta as duas metades. Procurar
// `/motor-api/api/ragnabot-fluxo` dentro do `.js` construído mede a forma do código, não o valor.
// Importar o módulo e LER o valor mede o que importa.
import { renderToString } from 'react-dom/server';
import CapaSecao from '../src/componentes/CapaSecao.jsx';
import { BASE_FLUXO, BASE_SESSAO } from '../src/lib/api.js';
import { BASE_RESPOSTAS } from '../src/lib/api-respostas-rapidas.js';
import { BASE_EMPRESAS } from '../src/lib/api-empresas.js';
import { BASENAME, PREFIXO } from '../src/lib/prefixo.js';

export const valores = { PREFIXO, BASENAME, BASE_FLUXO, BASE_SESSAO, BASE_RESPOSTAS, BASE_EMPRESAS };

export function capaHtml() {
  return renderToString(<CapaSecao secao="clientes" olho="Teste" titulo="Capa" />);
}
