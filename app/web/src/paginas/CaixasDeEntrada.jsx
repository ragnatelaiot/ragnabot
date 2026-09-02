// ════════════════════════════════════════════════════════════════════════════════════════════════
// CAIXAS DE ENTRADA — a tela (contrato S-CAIXAS, 02/09/2026)
//
// POR QUE ELA EXISTE, e a razão é uma medição, não uma ideia: em 02/09/2026 a plataforma tinha
// QUATRO caixas na conta 1 (1 Site · 34 WhatsApp · 35 Facebook · 36 Instagram) e 7 conversas
// reais — e `RagnabotInbox`, o cadastro do NOSSO lado, estava VAZIA. A rotina de reconciliação
// existia desde 28/08, com rota e tudo, e nunca havia sido chamada por ninguém. Ninguém tinha como
// perceber, porque não havia onde olhar. Um erro nesse cadastro não avisa: ele aparece dias depois
// como «o robô não responde», longe da causa.
//
// ── O QUE ESTA TELA MOSTRA (e o que ela deliberadamente NÃO mostra) ─────────────────────────────
// Mostra o NOSSO cadastro: id da caixa na plataforma, nome, canal, empresa e estado. É o que o
// motor consulta em execução — `caixaDaConversa()` para decidir botão × texto numerado, e
// `phoneNumberIdDaCaixa()` para saber a janela de 24 h do WhatsApp.
// NÃO mostra a lista ao vivo da plataforma lado a lado, e não é esquecimento: duas listas
// parecidas na mesma tela é o convite para o operador ler a errada. O botão «Sincronizar agora»
// resolve a diferença em vez de exibi-la, e o resumo diz, em português, o que mudou.
//
// ⛔ O QUE ELA NÃO FAZ, de propósito: criar e remover conexão. As duas exigem 2FA e credencial de
// canal (token da Meta, bot do Telegram) — isso é a tela de Empresas, com o portão dela. Aqui é
// conferência: leitura e reconciliação, as duas idempotentes.
//
// ── PARA TESTE ──────────────────────────────────────────────────────────────────────────────────
// `ListaDeCaixas` e `LinhaDeCaixa` são PUROS: recebem tudo por propriedade, não buscam nada, não
// chamam a rede. É o que permite medi-los com `renderToString`, sem navegador e sem servidor
// (`tests/caixas.smoke.mjs`). Só `CaixasDeEntrada`, embaixo, conversa com a rede.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, Search } from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
// Os tijolos visuais moram em `EmpresaFormulario.jsx` porque foi lá que nasceram (contrato
// S4-EMPRESAS). Reusar é a regra da casa — «não reescreva o que já existe, estenda».
import { Etiqueta, Faixa, T, Vazio, campoEstilo, cartao } from './EmpresaFormulario.jsx';
import { diagnosticar } from '../lib/api-empresas.js';
import {
  desdeQuando, lerCaixas, lerEstadoDaSincronizacao, resumirPassada, rotuloDoCanal, sincronizarAgora,
} from '../lib/api-caixas.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. PEÇAS PURAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Uma caixa. O `id` da plataforma vem em destaque porque é ELE que se digita ao amarrar um fluxo —
 *  e foi o campo errado (35 no lugar de 34, ou de 1) que originou este contrato inteiro. */
export function LinhaDeCaixa({ caixa }) {
  const ativa = caixa.ativa !== false;
  return (
    <div
      data-caixa={caixa.cwInboxId ?? 'sem-id'}
      style={{
        ...cartao, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        opacity: ativa ? 1 : 0.62,
      }}
    >
      {/* O id, em fonte de largura fixa: número que se copia tem de ser lido sem ambiguidade. */}
      <div style={{
        minWidth: 56, textAlign: 'center', padding: '6px 8px', borderRadius: 8,
        background: T.sup, border: `1px solid ${T.borda}`,
        fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '0.95rem', color: T.ink,
      }} title="Id da caixa na plataforma — é este número que vai no fluxo com entrada por caixa">
        {caixa.cwInboxId ?? '—'}
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, color: T.ink }}>{caixa.nome}</div>
        <div style={{ fontSize: '0.76rem', color: T.mut, marginTop: 2, wordBreak: 'break-all' }}>
          {caixa.identificador}
          {caixa.empresa ? <span style={{ color: T.sec }}> · {caixa.empresa.nome}</span> : null}
        </div>
      </div>

      <Etiqueta tom="info">{rotuloDoCanal(caixa)}</Etiqueta>

      {/* Estado NUNCA viaja só na cor: a palavra diz a mesma coisa que o tom. */}
      {ativa
        ? <Etiqueta tom="ok" titulo="Existe na plataforma na última conferência">Ativa</Etiqueta>
        : (
          <Etiqueta tom="aviso" titulo="Sumiu da plataforma — a linha ficou para o histórico, e não foi apagada">
            Inativa
          </Etiqueta>
        )}

      <div style={{ fontSize: '0.72rem', color: T.mut, minWidth: 110, textAlign: 'right' }}>
        {caixa.sincronizadaEm ? `conferida ${desdeQuando(caixa.sincronizadaEm)}` : 'nunca conferida'}
      </div>
    </div>
  );
}

export function ListaDeCaixas({ caixas = [], busca = '' }) {
  if (!caixas.length) {
    return (
      <Vazio>
        {busca
          ? `Nenhuma caixa casa com "${busca}".`
          : 'O cadastro de caixas está vazio. Clique em «Sincronizar agora»: nenhum fluxo com entrada '
            + 'por caixa consegue ser conferido enquanto este cadastro não tiver o que a plataforma tem.'}
      </Vazio>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {caixas.map((c) => <LinhaDeCaixa key={c.id ?? `${c.tenantId}-${c.cwInboxId}`} caixa={c} />)}
    </div>
  );
}

/** Filtro em memória. O servidor não recebe busca de propósito: o cadastro inteiro é pequeno (uma
 *  linha por conexão de cada empresa) e paginar isto seria complexidade sem cliente. */
export function filtrar(caixas, busca) {
  const q = String(busca || '').trim().toLowerCase();
  if (!q) return caixas;
  return caixas.filter((c) => [
    c.nome, c.identificador, c.tipoCanal, c.canalRotulo, c.empresa?.nome, String(c.cwInboxId ?? ''),
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function CaixasDeEntrada() {
  const [caixas, setCaixas] = useState([]);
  const [estado, setEstado] = useState(null);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState(null);
  const [recado, setRecado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [lista, sinc] = await Promise.all([
        lerCaixas(),
        // O estado da rotina é secundário: se ele falhar, a lista ainda vale. Falhar a tela
        // inteira por causa do painel de diagnóstico seria a cauda balançando o cachorro.
        lerEstadoDaSincronizacao().catch(() => null),
      ]);
      setCaixas(Array.isArray(lista) ? lista : []);
      setEstado(sinc);
      setErro(null);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    setSincronizando(true);
    setRecado(null);
    try {
      const r = await sincronizarAgora();
      setRecado({ tom: r?.empresasComErro ? 'aviso' : 'ok', texto: resumirPassada(r), erros: r?.erros || [] });
      await carregar();
    } catch (e) {
      setRecado({ tom: 'erro', texto: e.message, erros: [] });
    } finally {
      setSincronizando(false);
    }
  };

  const visiveis = useMemo(() => filtrar(caixas, busca), [caixas, busca]);
  const ativas = caixas.filter((c) => c.ativa !== false).length;
  const ajuda = diagnosticar(erro);

  return (
    <div>
      {/* ⚠️ `clientes` é a única capa presente neste repositório (`web/public/capas/`). Quando
          existir uma foto de «conexões», ela entra aqui — repetir a foto de Empresas é uma
          concessão consciente, e melhor que uma capa que devolve 404. */}
      <CapaSecao
        secao="clientes"
        olho="Ragnabot · Conexões"
        titulo="Caixas de entrada"
        apoio="O cadastro que o robô consulta para saber por onde a pessoa falou. Se ele estiver diferente da plataforma, o atendimento degrada em silêncio — é aqui que se confere e se acerta."
        acoes={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={carregar} disabled={carregando}>
              {carregando ? 'Consultando…' : 'Atualizar'}
            </button>
            <button className="btn btn-primary" onClick={sincronizar} disabled={sincronizando}>
              <RefreshCw size={15} /> {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
            </button>
          </div>
        }
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {recado ? (
          <Faixa tom={recado.tom} titulo={recado.tom === 'erro' ? 'A sincronização falhou' : 'Sincronização concluída'}>
            {recado.texto}
            {recado.erros?.length ? (
              <ul style={{ margin: '6px 0 0 18px' }}>
                {recado.erros.map((e, i) => <li key={i}>{e.empresa}: {e.erro}</li>)}
              </ul>
            ) : null}
          </Faixa>
        ) : null}

        {erro ? (
          <Faixa tom="erro" titulo="Não consegui ler o cadastro de caixas">
            {erro.message}
            {caixas.length ? ' A lista abaixo é a última leitura boa.' : ''}
            {ajuda ? (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.borda}`, color: T.mut }}>
                <b style={{ color: T.sec }}>Por que isto acontece: </b>{ajuda}
              </div>
            ) : null}
          </Faixa>
        ) : null}

        {/* O cadastro VAZIO é o estado que originou este contrato — ele merece uma frase, não um
            espaço em branco. Um cadastro vazio não trava o produto (a guarda do fluxo deixa passar
            com aviso, para não travar por dúvida), mas degrada o canal em silêncio. */}
        {!carregando && !caixas.length && !erro ? (
          <Faixa tom="aviso" titulo="Nenhuma caixa registrada deste lado">
            Enquanto este cadastro estiver vazio, o robô não sabe por qual canal a pessoa falou: ele
            trata todo canal como o mais pobre (texto numerado no lugar de botão) e não conhece a
            janela de 24 h do WhatsApp. Clique em «Sincronizar agora».
          </Faixa>
        ) : null}

        {estado ? (
          <div style={{ ...cartao, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8rem' }}>
            <span style={{ color: T.sec }}>
              <Inbox size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              <b style={{ color: T.ink }}>{ativas}</b> ativa(s) de <b style={{ color: T.ink }}>{caixas.length}</b> registrada(s)
            </span>
            <span style={{ color: T.mut }}>
              Rotina {estado.ligado ? `no ar (a cada ${Math.round((estado.intervaloMs || 0) / 60000)} min)` : 'desligada'}
              {' · '}
              {/* «Nunca rodou» dito em voz alta. O contrário — mostrar um traço — é como um cadastro
                  defasado passa despercebido por semanas. */}
              {estado.ultimaEm ? `última passada ${desdeQuando(estado.ultimaEm)}` : 'nunca rodou neste processo'}
            </span>
            {estado.ultimoErro ? <Etiqueta tom="erro" titulo={estado.ultimoErro}>último erro registrado</Etiqueta> : null}
          </div>
        ) : null}

        <div style={{ ...cartao, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: T.mut }} />
            <input
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Procurar por nome, número, canal, empresa ou id…"
              style={{ ...campoEstilo, paddingLeft: 32 }}
            />
          </div>
        </div>

        {carregando && !caixas.length
          ? (
            <div style={{ ...cartao, textAlign: 'center', padding: 40, color: T.mut }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Consultando o cadastro de caixas…
            </div>
          )
          : <ListaDeCaixas caixas={visiveis} busca={busca} />}
      </div>
    </div>
  );
}
