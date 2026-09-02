// ════════════════════════════════════════════════════════════════════════════════════════════════
// PONTO DE ENTRADA DA INTERFACE DO RAGNABOT
//
// Doc 33, Etapa 4. É o mínimo que uma página precisa para existir fora do NOC: fonte, tema, o
// respiro da página e a tela.
//
// ⭐ MUDOU EM 30/08/2026 (contrato S4-AUTH): passou a haver TELA DE ENTRADA. Antes, a credencial era
// injetada pelo motor no navegador (o token de serviço!) e quem alcançasse a URL entrava, com papel
// escolhido por cabeçalho. Agora a pessoa entra com a conta dela da plataforma e o motor emite um
// cookie assinado. `PortaoDeSessao` é quem decide entre a entrada e o resto.
//
// ⭐⭐ MUDOU EM 02/09/2026 (contrato S1 — doc 34 §F10.1/10.2): PASSOU A HAVER ROTEADOR E MENU.
// O cabeçalho anterior deste arquivo dizia, com todas as letras: «NÃO há roteador e NÃO há menu
// lateral — a interface tem uma página só». Era verdade, e era o gargalo nº 1 do plano inteiro: o
// construtor de fluxo existe e funciona desde 28/08, e o dono nunca o usou porque não havia caminho
// até ele (doc 34 §F1.1, causa medida). Sem roteador não cabia a segunda tela; sem a segunda tela
// não havia por que ter roteador. Este arquivo quebra o laço.
//
// ── POR QUE `react-router-dom`, E NÃO UM ROTEADOR DE CASA ───────────────────────────────────────
// Medido antes de acrescentar, como manda o contrato: o `package.json` desta interface tinha
// `react`, `react-dom`, `lucide-react` e `@fontsource/inter` — nenhum roteador, nem nada que
// servisse de equivalente. As opções eram escrever um (histórico, `popstate`, links que não
// quebram o «abrir em nova aba», rota ativa, redirecionamento) ou trazer o padrão da área. Escrevi
// a segunda: roteador de casa é a peça que parece trivial no primeiro dia e vira dívida no
// terceiro, quando alguém precisa de parâmetro de rota ou de rota aninhada.
//
// ── POR QUE CAMINHO DE VERDADE, E NÃO `#hash` ───────────────────────────────────────────────────
// `COMO-LIGAR-EMPRESAS.md` propôs `#empresas`, e naquele momento estava certo (era o mais barato e
// não exigia nada do servidor). Aqui vai o caminho de verdade porque o servidor JÁ SABE devolver a
// página em qualquer caminho de navegação — `servidor.js` tem o desvio-para-a-página desde a Etapa
// 4, e `web/tests/servir.smoke.mjs` o mede. Ou seja: o F5 em `/fluxos` já funcionava antes de este
// roteador existir. Aproveitar isso dá URL que se copia, se manda no WhatsApp e aparece certa no
// histórico. ⚠️ O `#hash` continua sendo do EDITOR (é onde ele guarda o fluxo aberto) — as duas
// coisas convivem porque uma usa o caminho e a outra a âncora.
//
// ⛔ O que eu deliberadamente NÃO trouxe do `main.jsx` do NOC: registro de service worker (a
// interface do Ragnabot ainda não é aplicativo instalável e um cache de shell mal versionado é a
// forma mais barata de servir a versão antiga para sempre), captura de IP local por WebRTC (é
// auditoria do NOC, e o Ragnabot tem a própria), troca de título por subdomínio e o remendo do
// `vite:preloadError`. Nenhum deles é desta tela; entram quando houver decisão para isso.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React, { useContext, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

// Fonte Inter hospedada por nós (@fontsource) — nunca por Google Fonts. Mesma decisão do NOC:
// resolve o SRI ausente, enxuga a CSP e tira a dependência de terceiro do caminho de carga.
// Subset latin cobre pt-BR. Só os pesos que o tema usa: 400 (texto), 600 (botão), 700 e 800 (capa).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';

import './estilos/tema.css';
import Casca, { Rodape } from './componentes/Casca.jsx';
import FluxosRagnabot from './paginas/FluxosRagnabot.jsx';
import RespostasRapidas from './paginas/RespostasRapidas.jsx';
import TestadorDeFluxo from './paginas/TestadorDeFluxo.jsx';
import Empresas from './paginas/Empresas.jsx';
import CaixasDeEntrada from './paginas/CaixasDeEntrada.jsx';
import { ContextoDaSessao, PortaoDeSessao } from './paginas/Entrada.jsx';
import { CAMINHO_PADRAO, itensVisiveis } from './lib/navegacao.js';
import { BASENAME, caminhoDoApp } from './lib/prefixo.js';
import { EVENTO_SESSAO_MUDOU, atorAtual, empresaAtual, versaoDoMotor } from './lib/api.js';

/**
 * A versão do motor, que chega DEPOIS.
 *
 * ⚠️ COMPORTAMENTO PRESERVADO do `main.jsx` anterior, e ele não é detalhe: quem traz a versão é a
 * resposta de `/sessao/eu` (ou da entrada), que é assíncrona. Ler uma vez na montagem deixaria
 * «versão não informada» congelado na tela para sempre — foi um defeito real, consertado em 30/08
 * com este mesmo `useEffect`. Ele só mudou de lugar: agora alimenta o rodapé da casca.
 */
function useVersao() {
  const [versao, setVersao] = useState(versaoDoMotor());
  useEffect(() => {
    const aoMudar = () => setVersao(versaoDoMotor());
    window.addEventListener(EVENTO_SESSAO_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_SESSAO_MUDOU, aoMudar);
  }, []);
  return versao;
}

/**
 * Tela para caminho que não existe.
 *
 * ⚠️ Ela precisa existir POR CAUSA do servidor, não apesar dele: o desvio-para-a-página devolve o
 * índice para QUALQUER caminho de navegação (é o que faz o F5 funcionar). Sem esta tela, um
 * `/fluxus` digitado errado renderizaria o nada — página em branco, 200 na rede, e ninguém
 * entendendo. Dizer «não encontrei, e aqui estão os caminhos» é a diferença entre um erro e um beco.
 */
function NaoEncontrada() {
  const local = useLocation();
  const itens = itensVisiveis(atorAtual().papel);
  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 'var(--peso-titulo)' }}>Não encontrei esta tela</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
        O endereço <code>{local.pathname}</code> não corresponde a nenhuma tela do Ragnabot.
      </p>
      <ul style={{ marginTop: 'var(--space-md)', paddingLeft: '1.1rem', color: 'var(--text-secondary)' }}>
        {itens.map((i) => (
          <li key={i.id} style={{ marginBottom: 4 }}>
            {/* ⚠️ `caminhoDoApp` e NÃO o caminho cru. Este é o ÚNICO `<a href>` de navegação da
                interface (o menu usa `NavLink`, que já respeita o `basename`). Publicada em
                `/painel/`, uma âncora crua mandaria o navegador para `/fluxos` na RAIZ do host —
                ou seja, para o Ingress da plataforma de atendimento, não para o motor. O sintoma
                seria a tela do Chatwoot abrindo no lugar do construtor, o que ninguém liga a um
                `href` esquecido numa página de "não encontrei". */}
            <a href={caminhoDoApp(i.caminho)}>{i.rotulo}</a> — {i.apoio}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A tela de Empresas é do OPERADOR do SaaS (doc 34 §F8, ordem do dono de 02/09).
 *
 * ⚠️ ISTO NÃO É A TRAVA. Quem tem de recusar é o servidor — e o teste de aceite escrito no doc 34 é
 * «um usuário de conta cliente chamando a rota PELA API recebe recusa, não a lista». Essa trava é o
 * sprint S7 e ainda NÃO existe: hoje `ragnabot-tenant.routes.js` é montado com `adminOnly`, o que
 * barra o atendente mas não separa admin-de-cliente de admin-da-Ragnatela. Este componente evita o
 * tropeço; ele não substitui a trava, e não pode ser confundido com ela.
 */
function SoAdministrador({ children }) {
  if (atorAtual().papel === 'admin') return children;
  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 'var(--peso-titulo)' }}>Tela de administração</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
        Esta tela é do administrador da conta. Se você precisa dela, peça a quem administra a sua
        empresa — quem decide isso é o servidor, não este aviso.
      </p>
    </div>
  );
}

/** O miolo: a casca com as telas dentro. Separado de `Aplicacao` porque precisa estar DENTRO do
 *  `BrowserRouter` (os ganchos do roteador só funcionam abaixo dele) e DENTRO do portão (para ler
 *  o aviso da sessão). */
function Miolo() {
  const { aviso } = useContext(ContextoDaSessao);
  const versao = useVersao();
  return (
    <Routes>
      <Route element={<Casca aviso={aviso} versao={versao} />}>
        {/* A raiz manda para o construtor: é o que o dono quer usar, e foi o que ele não achava. */}
        <Route path="/" element={<Navigate to={CAMINHO_PADRAO} replace />} />
        <Route path="/fluxos" element={<FluxosRagnabot />} />
        <Route path="/respostas-rapidas" element={<RespostasRapidas />} />
        {/* Duas rotas para a MESMA tela: sem fluxo escolhido ela lista; com fluxo, simula. A URL
            com o id existe para o operador poder mandar «confere este aqui» num link — que é como
            se pede revisão de fluxo na vida real. */}
        <Route path="/testador" element={<TestadorDeFluxo />} />
        <Route path="/testador/:fluxoId" element={<TestadorDeFluxo />} />
        {/* ⭐ Contrato S-CAIXAS (02/09/2026). Mesma trava de tela de Empresas, e pela mesma razão:
            é conferência de cadastro de conexão. E vale a mesma ressalva — ISTO NÃO É A TRAVA;
            quem recusa é o servidor (`ragnabot-tenant.routes.js`, já fechado a administrador do
            grupo RAGNATELA). Este componente evita o tropeço, não substitui a trava. */}
        <Route path="/caixas" element={<SoAdministrador><CaixasDeEntrada /></SoAdministrador>} />
        <Route path="/empresas" element={<SoAdministrador><Empresas ehSuperusuario={atorAtual().isSuperuser === true} /></SoAdministrador>} />
        {/* URL do tempo em que a tela morava no NOC. `servir.smoke.mjs` mede que ela devolve a
            página em vez de 404; sem esta linha ela passaria a cair no «não encontrei», que é
            quebrar a promessa por dentro depois de cumpri-la por fora. */}
        <Route path="/ragnabot-fluxos/*" element={<Navigate to="/fluxos" replace />} />
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
  );
}

function Aplicacao() {
  const versao = useVersao();
  return (
    <PortaoDeSessao rodape={<Rodape versao={versao} empresa={empresaAtual()} />}>
      {/* ⚠️ `basename` NÃO é enfeite: o motor pode estar publicado sob um prefixo
          (`bot.ragnatela.com.br/motor-api/`, hoje, no manifesto). Sem ele, o roteador escreveria
          `/fluxos` na barra do navegador — endereço que cai no Ingress da PLATAFORMA, não no motor.
          Na raiz o valor é '' e o comportamento é idêntico ao de antes. Ver `lib/prefixo.js`. */}
      <BrowserRouter basename={BASENAME}>
        <Miolo />
      </BrowserRouter>
    </PortaoDeSessao>
  );
}

ReactDOM.createRoot(document.getElementById('raiz')).render(
  <React.StrictMode>
    <Aplicacao />
  </React.StrictMode>,
);
