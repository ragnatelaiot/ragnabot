// ════════════════════════════════════════════════════════════════════════════════════════════════
// PONTO DE ENTRADA DA INTERFACE DO RAGNABOT
//
// Doc 33, Etapa 4. É o mínimo que uma página precisa para existir fora do NOC: fonte, tema, o
// respiro da página e a tela. NÃO há roteador e NÃO há menu lateral — a interface tem uma página
// só, e o motor a serve.
//
// ⭐ MUDOU EM 30/08/2026 (contrato S4-AUTH): AGORA HÁ TELA DE ENTRADA. Antes, a credencial era
// injetada pelo motor no navegador (o token de serviço!) e quem alcançasse a URL entrava, com
// papel escolhido por cabeçalho. Agora a pessoa entra com a conta dela da plataforma e o motor
// emite um cookie assinado. `PortaoDeSessao` é quem decide entre a entrada e o editor; esta
// função aqui só monta a página.
//
// ⛔ O que eu deliberadamente NÃO trouxe do `main.jsx` do NOC: registro de service worker (a
// interface do Ragnabot ainda não é aplicativo instalável e um cache de shell mal versionado é a
// forma mais barata de servir a versão antiga para sempre), captura de IP local por WebRTC (é
// auditoria do NOC, e o Ragnabot tem a própria), troca de título por subdomínio e o remendo do
// `vite:preloadError`. Nenhum deles é desta tela; entram quando houver decisão para isso.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

// Fonte Inter hospedada por nós (@fontsource) — nunca por Google Fonts. Mesma decisão do NOC:
// resolve o SRI ausente, enxuga a CSP e tira a dependência de terceiro do caminho de carga.
// Subset latin cobre pt-BR. Só os pesos que o tema usa: 400 (texto), 600 (botão), 700 e 800 (capa).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';

import './estilos/tema.css';
import FluxosRagnabot from './paginas/FluxosRagnabot.jsx';
import { PortaoDeSessao } from './paginas/Entrada.jsx';
import { EVENTO_SESSAO_MUDOU, versaoDoMotor } from './lib/api.js';

function Aplicacao() {
  // A versão aparece no rodapé porque foi ela o motivo declarado da separação (doc 33 §0): numerar
  // o produto num repositório que não continha o produto. Se o motor não a informar, dizemos isso —
  // em vez de mostrar um número inventado.
  //
  // ⚠️ Ela chega DEPOIS: quem a traz é a resposta de `/sessao/eu` (ou da entrada), que é assíncrona.
  // Ler uma vez na montagem deixaria "versão não informada" congelado na tela para sempre.
  const [versao, setVersao] = useState(versaoDoMotor());
  useEffect(() => {
    const aoMudar = () => setVersao(versaoDoMotor());
    window.addEventListener(EVENTO_SESSAO_MUDOU, aoMudar);
    return () => window.removeEventListener(EVENTO_SESSAO_MUDOU, aoMudar);
  }, []);
  return (
    <div className="pagina">
      {/* O portão pergunta ao motor quem está logado ANTES de montar o editor. Montar o editor
          "por otimismo" faria ele pedir dados, tomar 401 e voltar piscando para a entrada. */}
      <PortaoDeSessao>
        <FluxosRagnabot />
      </PortaoDeSessao>
      <footer style={{ marginTop: 24, color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'right' }}>
        RAGNABOT {versao ? `· versão ${versao}` : '· versão não informada pelo motor'}
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('raiz')).render(
  <React.StrictMode>
    <Aplicacao />
  </React.StrictMode>,
);
