// ════════════════════════════════════════════════════════════════════════════════════════════════
// CONEXÕES — a tela (contrato S6, 02/09/2026 · doc 34 §F9.2.3 a §F9.2.7)
//
// ── O QUE ELA É, E O QUE ELA **NÃO** É ─────────────────────────────────────────────────────────
// É a tela 40 do chat atual: um cartão por canal, com o id, o nome, o número, a última atualização
// e o SINAL de estado — mais o que o Ragnabot tem e o chat atual não: QUEM OPERA a conexão
// (provedor), a cota do plano e o registro de requisições.
//
// NÃO é a tela «Caixas de entrada» (`CaixasDeEntrada.jsx`), e a diferença é de propósito:
//   · Caixas de entrada  = CONFERÊNCIA do cadastro contra a plataforma (ler e reconciliar)
//   · Conexões           = OPERAÇÃO da conexão (provedor, estado, reinício, transferência, cota)
// Duas telas parecidas com a MESMA função seriam o convite para o operador usar a errada; duas com
// funções diferentes que compartilham dado são o desenho normal. Quem cria e remove conexão
// continua sendo a tela de Empresas — lá está o portão de 2FA e a credencial do canal.
//
// ── PARA TESTE ──────────────────────────────────────────────────────────────────────────────────
// Tudo acima de `Conexoes` é PURO: recebe por propriedade, não busca nada, não chama a rede. É o
// que permite medir com `renderToString`, sem navegador e sem servidor (`tests/conexoes.smoke.mjs`).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plug, RefreshCw, Search, ArrowRightLeft } from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
// Os tijolos visuais moram em `EmpresaFormulario.jsx` porque foi lá que nasceram. Reusar é a regra
// da casa — «não reescreva o que já existe, estenda».
import { Etiqueta, Faixa, T, Vazio, cartao } from './EmpresaFormulario.jsx';
import { diagnosticar } from '../lib/api-empresas.js';
import {
  corDoUso, desdeQuando, frasearCota, frescorDaMedicao, lerConexoes, lerCota,
  opcoesDeConexao, previaDeTransferencia, reiniciarConexao, sinalDe, transferir, trocarProvedor,
} from '../lib/api-conexoes.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. PEÇAS PURAS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** O sinal de estado. ⚠️ A cor NUNCA carrega a informação sozinha: a palavra diz o mesmo. Daltonismo
 *  é a razão declarada, e o segundo motivo é que cor não sobrevive a uma captura de tela em cinza. */
export function Sinal({ conexao }) {
  const s = sinalDe(conexao);
  const f = frescorDaMedicao(conexao);
  return (
    <span
      title={`${s.rotulo} — ${f.texto}${conexao?.estadoDetalhe ? `. ${conexao.estadoDetalhe}` : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: s.cor, fontWeight: 700, fontSize: '0.82rem' }}
    >
      <span aria-hidden="true">{s.simbolo}</span>
      {s.rotulo}
      {/* A idade da medição vem JUNTO do estado, e não escondida numa dica: «Conectada» de três
          dias atrás parece atual, e é aí que a tela engana quem está de plantão. */}
      <span style={{ color: f.velha ? T.aviso : T.mut, fontWeight: 500 }}>({f.texto})</span>
    </span>
  );
}

/** Um cartão de conexão — a tela 40 do chat atual, com o que temos a mais. */
export function CartaoDeConexao({ conexao, administra = false, ocupado = false, aoReiniciar, aoTrocarProvedor, aoTransferir }) {
  const ativa = conexao.ativa !== false;
  return (
    <div
      data-conexao={conexao.cwInboxId ?? 'sem-id'}
      style={{ ...cartao, padding: 14, display: 'grid', gap: 10, opacity: ativa ? 1 : 0.62 }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* O id em fonte de largura fixa: número que se copia tem de ser lido sem ambiguidade — e
            é ELE que se digita ao amarrar um fluxo a uma caixa. */}
        <div
          title="Id da conexão na plataforma — é este número que vai no fluxo com entrada por caixa"
          style={{
            minWidth: 56, textAlign: 'center', padding: '6px 8px', borderRadius: 8,
            background: T.sup, border: `1px solid ${T.borda}`,
            fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: T.ink,
          }}
        >
          {conexao.cwInboxId ?? '—'}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, color: T.ink }}>{conexao.nome}</div>
          <div style={{ fontSize: '0.76rem', color: T.mut, marginTop: 2, wordBreak: 'break-all' }}>
            {conexao.identificador}
          </div>
        </div>

        <Etiqueta tom="info">{conexao.canalRotulo}</Etiqueta>
        <Etiqueta tom={conexao.provedorOficial ? 'ok' : 'aviso'} titulo={conexao.capacidadeResumo}>
          {conexao.provedorRotulo}
        </Etiqueta>
        <Sinal conexao={conexao} />
      </div>

      {/* O que este par canal+provedor CONSEGUE fazer, em português. Sem esta linha,
          «interativo: false» não diz a ninguém que o menu vai virar lista numerada no celular. */}
      <div style={{ fontSize: '0.76rem', color: T.sec }}>{conexao.capacidadeResumo}</div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem', color: T.mut }}>
        <span>atualizada {desdeQuando(conexao.atualizadaEm) || '—'}</span>
        {conexao.sincronizadaEm ? <span>· conferida {desdeQuando(conexao.sincronizadaEm)}</span> : null}
        {conexao.reiniciadaEm ? <span>· reiniciada {desdeQuando(conexao.reiniciadaEm)}</span> : null}
        {!ativa ? <Etiqueta tom="aviso" titulo="Sumiu da plataforma — a linha ficou para o histórico">Desligada</Etiqueta> : null}

        {administra && ativa ? (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" disabled={ocupado} onClick={() => aoReiniciar?.(conexao)}>
              <RefreshCw size={14} /> Reiniciar
            </button>
            <button className="btn btn-secondary" disabled={ocupado} onClick={() => aoTrocarProvedor?.(conexao)}>
              Trocar provedor
            </button>
            <button className="btn btn-secondary" disabled={ocupado} onClick={() => aoTransferir?.(conexao)}>
              <ArrowRightLeft size={14} /> Transferir atendimentos
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A cota: barra, número e a frase que responde «posso ligar mais uma?». */
export function PainelDeCota({ cota }) {
  if (!cota) return null;
  const pct = Math.min(100, cota.usoPct ?? 0);
  return (
    <div style={{ ...cartao, padding: 14, display: 'grid', gap: 8 }} data-cota="total">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ color: T.ink }}>Cota de conexões</strong>
        <span style={{ color: T.sec, fontSize: '0.82rem' }}>{frasearCota(cota)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: T.sup, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: corDoUso(cota.usoPct) }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(cota.porCanal || []).filter((c) => c.incluidoNoPlano).map((c) => (
          <Etiqueta key={c.canal} tom={c.esgotado ? 'aviso' : 'neutro'} titulo={`${c.ativos} de ${c.limite}`}>
            {c.canalRotulo}: {c.ativos}/{c.limite}
          </Etiqueta>
        ))}
      </div>
    </div>
  );
}

export function ListaDeConexoes({ conexoes = [], busca = '', ...resto }) {
  if (!conexoes.length) {
    return (
      <Vazio>
        {busca
          ? `Nenhuma conexão casa com "${busca}".`
          : 'Nenhuma conexão cadastrada. Crie a primeira na tela de Empresas — é lá que fica o portão '
            + 'de 2FA e a credencial do canal.'}
      </Vazio>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {conexoes.map((c) => (
        <CartaoDeConexao key={c.id ?? `${c.tenantId}-${c.cwInboxId}`} conexao={c} {...resto} />
      ))}
    </div>
  );
}

/** Filtro em memória: o cadastro é pequeno (uma linha por conexão) e paginar seria complexidade
 *  sem cliente. Mesma decisão declarada em `CaixasDeEntrada.jsx`. */
export function filtrar(conexoes, busca) {
  const q = String(busca || '').trim().toLowerCase();
  if (!q) return conexoes;
  return conexoes.filter((c) => [
    c.nome, c.identificador, c.tipoCanal, c.canalRotulo, c.provedor, c.provedorRotulo, String(c.cwInboxId ?? ''),
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function Conexoes() {
  const [conexoes, setConexoes] = useState([]);
  const [cota, setCota] = useState(null);
  const [opcoes, setOpcoes] = useState(null);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [recado, setRecado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [lista, c, o] = await Promise.all([
        lerConexoes(),
        // Cota e vocabulário são secundários: falhar a tela inteira por causa deles seria a cauda
        // balançando o cachorro.
        lerCota().catch(() => null),
        opcoesDeConexao().catch(() => null),
      ]);
      setConexoes(Array.isArray(lista?.conexoes) ? lista.conexoes : []);
      setCota(c);
      setOpcoes(o);
      setErro(null);
    } catch (e) {
      setErro(e);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const aoReiniciar = async (conexao) => {
    setOcupado(true); setRecado(null);
    try {
      const r = await reiniciarConexao(conexao.cwInboxId, 'reinício pedido na tela de Conexões');
      // ⚠️ `naoDisponivel` NÃO é sucesso, e a tela diz isso: botão que pisca «pronto» sem ter feito
      // nada é a pior coisa que uma tela de suporte pode fazer.
      setRecado({ tom: r.resultado === 'reiniciada' ? 'ok' : 'aviso', texto: r.mensagem });
      await carregar();
    } catch (e) {
      setRecado({ tom: 'erro', texto: e.message });
    } finally { setOcupado(false); }
  };

  const aoTrocarProvedor = async (conexao) => {
    const disponiveis = (opcoes?.provedores || []).filter((p) => p.canais?.includes(conexao.tipoCanal));
    const escolha = typeof window !== 'undefined'
      ? window.prompt(
        `Quem opera "${conexao.nome}" (${conexao.canalRotulo})?\n\n`
        + disponiveis.map((p) => `${p.id} — ${p.rotulo}${p.oficial ? '' : ' (não oficial)'}`).join('\n')
        + '\n\nDigite o identificador do provedor:',
        conexao.provedor,
      )
      : null;
    if (!escolha || escolha === conexao.provedor) return;
    setOcupado(true); setRecado(null);
    try {
      const r = await trocarProvedor(conexao.cwInboxId, { provedor: escolha.trim() });
      setRecado({ tom: 'ok', texto: `A conexão ${r.cwInboxId} passou a ser operada por "${r.provedorRotulo}". ${r.capacidadeResumo}` });
      await carregar();
    } catch (e) {
      setRecado({ tom: 'erro', texto: e.message });
    } finally { setOcupado(false); }
  };

  const aoTransferir = async (origem) => {
    const candidatas = conexoes.filter((c) => c.ativa !== false && c.cwInboxId !== origem.cwInboxId);
    if (!candidatas.length) {
      setRecado({ tom: 'aviso', texto: 'Não há outra conexão ativa para receber os atendimentos.' });
      return;
    }
    const destino = typeof window !== 'undefined'
      ? window.prompt(
        `Mover os atendimentos abertos de "${origem.nome}" (${origem.cwInboxId}) para qual conexão?\n\n`
        + candidatas.map((c) => `${c.cwInboxId} — ${c.nome} (${c.canalRotulo})`).join('\n')
        + '\n\nDigite o id da conexão de destino:',
      )
      : null;
    if (!destino) return;
    setOcupado(true); setRecado(null);
    try {
      // ⚠️ PRÉVIA ANTES DE CONFIRMAR, sempre. Transferência em massa sem prévia é o tipo de botão
      // que se aperta uma vez e se lamenta o resto do dia.
      const p = await previaDeTransferencia({ de: origem.cwInboxId, para: Number(destino) });
      const confirma = typeof window !== 'undefined' && window.confirm(
        `${p.total} atendimento(s) de "${p.origem.nome}" passariam a ser roteados por "${p.destino.nome}".`
        + `${p.avisoDeCanal ? `\n\n⚠️ ${p.avisoDeCanal}` : ''}`
        + '\n\nConfirma?',
      );
      if (!confirma) { setOcupado(false); return; }
      const motivo = typeof window !== 'undefined' ? window.prompt('Por quê? (fica no registro e na conversa)') : null;
      if (!motivo || motivo.trim().length < 5) {
        setRecado({ tom: 'aviso', texto: 'Transferência cancelada: o motivo é obrigatório — é o que explica a mudança meses depois.' });
        setOcupado(false);
        return;
      }
      const r = await transferir({ de: origem.cwInboxId, para: Number(destino), motivo, forcarCanalDiferente: !!p.avisoDeCanal });
      setRecado({ tom: r.falhas ? 'aviso' : 'ok', texto: r.mensagem });
      await carregar();
    } catch (e) {
      setRecado({ tom: 'erro', texto: e.message });
    } finally { setOcupado(false); }
  };

  const visiveis = useMemo(() => filtrar(conexoes, busca), [conexoes, busca]);
  const ativas = conexoes.filter((c) => c.ativa !== false).length;
  const ajuda = diagnosticar(erro);

  return (
    <div>
      <CapaSecao
        secao="clientes"
        olho="Ragnabot · Conexões"
        titulo="Conexões"
        apoio="Por onde o cliente fala com a empresa: o canal, quem opera esse canal, como ele está e quanto do plano já foi usado."
        acoes={
          <button className="btn btn-secondary" onClick={carregar} disabled={carregando}>
            {carregando ? 'Consultando…' : 'Atualizar'}
          </button>
        }
      />

      <div style={{ display: 'grid', gap: 12 }}>
        {recado ? (
          <Faixa tom={recado.tom} titulo={recado.tom === 'erro' ? 'Não deu certo' : recado.tom === 'aviso' ? 'Atenção' : 'Pronto'}>
            {recado.texto}
          </Faixa>
        ) : null}

        {erro ? (
          <Faixa tom="erro" titulo="Não consegui carregar as conexões">
            {ajuda?.mensagem || erro.message}
          </Faixa>
        ) : null}

        <PainelDeCota cota={cota} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: T.mut }} />
            <input
              className="input"
              style={{ paddingLeft: 32, width: '100%' }}
              placeholder="Buscar por nome, número, canal ou provedor…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <span style={{ color: T.mut, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plug size={14} /> {ativas} ativa(s) de {conexoes.length}
          </span>
        </div>

        <ListaDeConexoes
          conexoes={visiveis}
          busca={busca}
          administra={opcoes?.administra === true}
          ocupado={ocupado}
          aoReiniciar={aoReiniciar}
          aoTrocarProvedor={aoTrocarProvedor}
          aoTransferir={aoTransferir}
        />
      </div>
    </div>
  );
}
