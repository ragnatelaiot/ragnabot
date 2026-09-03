// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CASCA — menu lateral, cabeçalho e rodapé. O lugar onde as telas do Ragnabot passam a morar.
//
// Contrato S1 (02/09/2026), doc 34 §F10.2. Nasceu de uma medição, não de gosto: o construtor de
// fluxo existe desde 28/08 e o dono nunca o usou, porque a interface do motor era UMA página só —
// sem menu, sem link, sem caminho. O doc 34 §F1.1 registra a causa com todas as letras. A casca
// deixa de ser estética e vira pré-requisito de adoção.
//
// ── AS TRÊS DECISÕES QUE VALE EXPLICAR ──────────────────────────────────────────────────────────
//
// 1. O CABEÇALHO NÃO É FIXO (`sticky`), e isso é de propósito. `CapaSecao` já é `position: sticky;
//    top: 0` e ENCOLHE ao rolar — é ela que sustenta a orientação durante o trabalho. Dois
//    elementos disputando o topo da janela dariam um deles cobrindo o outro em alguma largura, e o
//    sintoma apareceria só no computador de quem usa. Quem gruda é a capa; o cabeçalho rola.
//
// 2. O MENU É `<nav>` COM `<a>` DE VERDADE (o `NavLink` do roteador vira `<a href>`). Botão que
//    chama `navigate()` não abre em nova aba, não copia endereço e não aparece no histórico — e a
//    dor que estamos consertando é justamente "não consigo chegar lá".
//
// 3. QUEM VÊ O QUÊ VEM DE `lib/navegacao.js`, e a regra está escrita lá: esconder item de menu NÃO
//    é isolamento. Quem tranca é o servidor. Aqui só se evita tropeço.
//
// ── ⭐⭐ 02/09/2026 (contrato S-CASCA): O PAINEL PASSOU A SER UM SÓ ──────────────────────────────
// Este bloco dizia, até hoje: «ela NÃO embute o painel do fornecedor nem injeta script nele». A
// PRIMEIRA metade caiu — por decisão do chefe, com a medição na mão (ver `PainelDoFornecedor.jsx`):
// as telas que ainda são do fornecedor abrem DENTRO desta casca, e o menu à esquerda é um só.
//
// ⛔ A SEGUNDA METADE NÃO CAIU, E NÃO CAI: **nunca injetar script no painel do fornecedor.** O
//    remendo por JavaScript quebrou o painel DUAS VEZES em 31/08/2026. A casca ENVOLVE; ela não
//    remenda. Nada é escrito dentro do quadro, nenhum arquivo dele é reescrito, nenhuma função
//    dele é substituída — e nenhuma proteção dele foi desligada para o quadro caber.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3, Building2, CalendarClock, FlaskConical, Inbox, LogOut, Menu, MessageCircle,
  MessagesSquare, Plug, Settings, Users, Workflow, X, Zap,
} from 'lucide-react';

import { atorAtual, empresaAtual, sair, versaoDoMotor } from '../lib/api.js';
import { ehEmbutido, ehItemAtivo, itemPorCaminho, itensVisiveis } from '../lib/navegacao.js';

/** O catálogo guarda o NOME do ícone (é JavaScript puro e não pode conter JSX); a tradução para o
 *  componente mora aqui. Ícone desconhecido cai no de fluxo em vez de derrubar a tela. */
// ⭐ 02/09/2026 (contrato S7): `Settings` entrou com a tela de Configurações. Ícone sem tela é
// item de menu que abre o nada — a regra de `lib/navegacao.js`, repetida aqui.
// ⭐ 02/09/2026 (contrato S-CASCA): entraram `MessageCircle` (Conversas), `Users` (Contatos) e
// `BarChart3` (Relatórios), as três telas do fornecedor que passaram a abrir dentro da casca. E
// entraram também `Plug` e `CalendarClock`, que o catálogo já pedia e este mapa não tinha — sem
// eles, «Conexões» e «Agendamentos» desenhavam o ícone de fluxo, o do vizinho errado.
const ICONES = {
  Workflow, Zap, Building2, FlaskConical, Inbox, MessagesSquare, Settings,
  MessageCircle, Users, BarChart3, Plug, CalendarClock,
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MENU LATERAL
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function MenuLateral({ papel, operadorDoSaas = false, aberto = false, aoFechar = () => {} }) {
  // ⭐ 02/09/2026 (contrato S7). `operadorDoSaas` vem do SERVIDOR (`GET /api/ragnabot-config/quem-sou`),
  // nunca de uma dedução por nome de empresa — nome é dado de cadastro e uma empresa cliente que se
  // renomeasse "Ragnatela" herdaria o menu. E, como sempre: isto é DESENHO. A trava é
  // `src/base/operador-saas.js`, no servidor, medida por API.
  const itens = itensVisiveis(papel, { operadorDoSaas });
  return (
    <>
      {/* O véu só existe no celular, e só quando o menu está aberto. Fechar tocando fora é o gesto
          que todo mundo já tem no dedo — sem ele, a única saída é o X, e alguém não acha. */}
      {aberto && <div className="casca__veu" onClick={aoFechar} aria-hidden="true" />}

      <aside className={aberto ? 'casca__menu casca__menu--aberto' : 'casca__menu'}
        aria-label="Menu principal">
        <div className="casca__marca">
          <span className="casca__marca-olho">Ragnatela</span>
          <strong className="casca__marca-nome">RAGNABOT</strong>
          <button type="button" className="casca__fechar" onClick={aoFechar} aria-label="Fechar o menu">
            <X size={18} />
          </button>
        </div>

        <nav className="casca__nav">
          {itens.map((item) => {
            const Icone = ICONES[item.icone] || Workflow;
            // ⭐ 02/09/2026 (contrato S-CASCA). O item embutido é marcado, e a marca é HONESTA: a
            // tela é do painel de atendimento, aberta aqui dentro. Sem ela, o dia em que uma delas
            // se comportar diferente das nossas (atalho de teclado, botão de voltar) a pessoa vai
            // achar que o Ragnabot quebrou. Dizer de quem é a tela custa um ponto na lateral.
            const doFornecedor = ehEmbutido(item);
            return (
              <NavLink
                key={item.id}
                to={item.caminho}
                data-item={item.id}
                data-embutido={doFornecedor ? '1' : undefined}
                title={doFornecedor ? `${item.apoio} · tela do painel de atendimento` : item.apoio}
                onClick={aoFechar}
                className={({ isActive }) => (isActive ? 'casca__item casca__item--ativo' : 'casca__item')}
              >
                <Icone size={17} aria-hidden="true" />
                <span>{item.rotulo}</span>
                {doFornecedor && (
                  <span className="casca__marca-embutido" title="Tela do painel de atendimento, aberta dentro do Ragnabot">
                    {/* Texto para quem usa leitor de tela; o ponto verde é só para o olho. */}
                    <span className="casca__so-leitor">tela do painel de atendimento</span>
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* ⭐ REESCRITO EM 02/09/2026 (contrato S-CASCA). Este parágrafo dizia quais telas ainda
            NÃO existiam aqui e por isso obrigavam a pessoa a sair para o painel de atendimento.
            Não obrigam mais: com a casca única, elas abrem AQUI DENTRO, com este mesmo menu ao
            lado. O que continua valendo — e é o que ele diz agora — é DE QUEM é cada tela, porque
            é isso que explica a diferença de comportamento quando ela aparece.
            ⚠️ Ao substituir uma tela do fornecedor pela nossa, o ponto some sozinho (é o campo
            `embutido` do catálogo) e esta frase continua verdadeira sem ninguém mexer nela. */}
        <p className="casca__rodape-menu">
          Os itens marcados com <span className="casca__marca-embutido casca__marca-embutido--exemplo" aria-hidden="true" /> ainda
          são telas do painel de atendimento — abrem aqui dentro, com este menu do lado, e não
          pedem senha de novo. Vamos substituindo uma a uma; quando isso acontece, o ponto some e
          nada mais muda para você. Criar e remover conexão, que pede segundo fator e credencial de
          canal, continua em Empresas e no painel de atendimento.
        </p>
      </aside>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CABEÇALHO — quem está logado, em que empresa, e a saída
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function Cabecalho({ aviso, aoAbrirMenu = () => {}, titulo = null, ator = null, empresa = null }) {
  // ⚠️ O ator e a empresa CHEGAM POR PROPRIEDADE, com o padrão vindo da sessão. Não é cerimônia:
  // é o que permite renderizar a casca num teste sem navegador e sem servidor, escolhendo o papel
  // (`tests/navegacao.smoke.mjs`). Sem esta costura, «o atendente não vê Empresas» só daria para
  // medir no catálogo — e catálogo certo com componente que o ignora passa no teste e falha na tela.
  const quem = ator || atorAtual();
  const daEmpresa = empresa || empresaAtual();
  const [saindo, setSaindo] = useState(false);

  return (
    <header className="casca__cabecalho">
      <button type="button" className="casca__abrir btn btn-secondary" onClick={aoAbrirMenu}
        aria-label="Abrir o menu">
        <Menu size={18} />
      </button>

      <div className="casca__cabecalho-txt">
        {titulo && <span className="casca__cabecalho-tela">{titulo}</span>}
        {daEmpresa?.nome && <span className="casca__cabecalho-empresa">{daEmpresa.nome}</span>}
      </div>

      {/* `role="status"` porque o aviso mais comum é "sua conta ainda não está cadastrada" — quem
          usa leitor de tela precisa ouvir isso, senão a tela vazia não se explica. */}
      {aviso && <span role="status" className="casca__aviso">{aviso}</span>}

      <span className="casca__ator">
        {quem.nome || 'você'}
        <span className="casca__papel">{quem.papel === 'admin' ? 'administrador' : 'atendente'}</span>
      </span>

      <button type="button" className="btn btn-secondary" disabled={saindo}
        onClick={async () => {
          setSaindo(true);
          await sair();
          // Recarregar em vez de trocar de estado: garante que nada da tela anterior (rascunho de
          // fluxo em memória, temporizador de teste) sobreviva à troca de pessoa na mesma máquina.
          window.location.reload();
        }}>
        <LogOut size={15} /> {saindo ? 'Saindo…' : 'Sair'}
      </button>
    </header>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RODAPÉ — empresa e versão (doc 34 §F5.2)
//
// ⚠️ A VERSÃO CHEGA DEPOIS, e este componente tem de sobreviver a isso. Quem a traz é a resposta de
// `/sessao/eu` (ou da entrada), que é assíncrona: ler uma vez na montagem deixaria "versão não
// informada" congelado na tela para sempre — foi defeito real, consertado em 30/08. O comportamento
// está PRESERVADO: quem escuta `EVENTO_SESSAO_MUDOU` é o gancho `useVersao` de `main.jsx`, e o
// valor chega aqui por propriedade. Este componente é puro de propósito (é o que o teste renderiza).
// ⛔ E não se inventa "1.00.00" quando o motor não informa: dizer que não sabe é a resposta honesta.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function Rodape({ versao, empresa }) {
  return (
    <footer className="casca__rodape">
      <span>RAGNABOT</span>
      {empresa?.nome ? <span>· {empresa.nome}</span> : null}
      <span>{versao ? `· versão ${versao}` : '· versão não informada pelo motor'}</span>
      <span className="casca__assinatura">· Desenvolvido por Ragnatela IoT Solutions</span>
    </footer>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A CASCA
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⭐ 02/09/2026 (contrato S7). `operadorDoSaas` é um PARÂMETRO opcional só para poder ser MEDIDO:
// `null` (o normal, em produção) = pergunte ao servidor; booleano = use este valor. O teste de
// renderização precisa fixar o fato sem rede, e um teste que não consegue fixar a entrada mede
// sorte, não comportamento.
export default function Casca({ aviso = null, versao = null, ator = null, empresa = null, operadorDoSaas: operadorFixo = null }) {
  const quem = ator || atorAtual();
  const daEmpresa = empresa || empresaAtual();
  const local = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  // ⭐ 02/09/2026 (contrato S7). UMA pergunta ao servidor, no arranque da casca: «esta conta opera
  // o SaaS?». Enquanto ele não responde, o padrão é FALSO — item que pisca e some é pior que item
  // que aparece um segundo depois. Falha na chamada também deixa falso: falha FECHADA.
  const [operadorDoSaas, setOperadorDoSaas] = useState(operadorFixo === true);
  useEffect(() => {
    if (operadorFixo !== null) { setOperadorDoSaas(operadorFixo === true); return undefined; }
    let vivo = true;
    import('../lib/api-configuracoes.js')
      .then((m) => m.quemSou())
      .then((r) => { if (vivo) setOperadorDoSaas(r?.operadorDoSaas === true); })
      .catch(() => { if (vivo) setOperadorDoSaas(false); });
    return () => { vivo = false; };
  }, [operadorFixo]);

  // Trocar de tela fecha o menu do celular. Sem isto, o menu fica por cima da tela recém-aberta e
  // parece que o clique não funcionou.
  useEffect(() => { setMenuAberto(false); }, [local.pathname]);

  // O título da aba acompanha a tela. É o que faz a segunda aba do navegador ser reconhecível —
  // e quem trabalha o dia inteiro tem várias.
  useEffect(() => {
    const item = itemPorCaminho(local.pathname)
      || itensVisiveis(quem.papel, { operadorDoSaas }).find((i) => ehItemAtivo(i, local.pathname));
    document.title = item ? `RAGNABOT — ${item.rotulo}` : 'RAGNABOT';
  }, [local.pathname, quem.papel, operadorDoSaas]);

  const tela = itemPorCaminho(local.pathname)
    || itensVisiveis(quem.papel, { operadorDoSaas }).find((i) => ehItemAtivo(i, local.pathname))
    || null;

  return (
    <div className="casca">
      <MenuLateral papel={quem.papel} operadorDoSaas={operadorDoSaas} aberto={menuAberto} aoFechar={() => setMenuAberto(false)} />
      <div className="casca__coluna">
        <Cabecalho aviso={aviso} titulo={tela?.rotulo || null} ator={quem} empresa={daEmpresa}
          aoAbrirMenu={() => setMenuAberto(true)} />
        {/* `.pagina` continua sendo o container de respiro das telas — é dele que `CapaSecao` lê a
            `--capa-sangria` para se esticar até a borda. Trocar esta classe faria toda capa nascer
            com margem errada, e o sintoma (faixa branca nas laterais) não aponta para cá. */}
        <main className="pagina casca__conteudo">
          <Outlet />
        </main>
        <Rodape versao={versao ?? versaoDoMotor()} empresa={daEmpresa} />
      </div>
    </div>
  );
}
