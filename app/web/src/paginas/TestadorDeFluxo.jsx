// ════════════════════════════════════════════════════════════════════════════════════════════════
// TESTADOR DE FLUXO — a tela (contrato S3.1, 02/09/2026 · doc 34 §F3.1, doc 35 §S3)
//
// Pedido explícito do dono: *"dentro do fluxo faça um testador de fluxo"*. É o item mais pedido do
// plano de paridade, e o motivo é simples: hoje a única forma de saber se um fluxo funciona é
// publicá-lo e mandar um cliente conversar com ele.
//
// ── MEDIÇÃO QUE MUDOU O TAMANHO DESTE TRABALHO ──────────────────────────────────────────────────
// O MOTOR DO TESTADOR JÁ EXISTIA. `POST /api/ragnabot-fluxo/fluxos/:id/testar` percorre o fluxo de
// ponta a ponta usando os MESMOS executores da produção, sem enviar mensagem, sem chamar terceiro,
// sem decifrar segredo e sem gravar linha nenhuma — e há um teste permanente que prende essa última
// promessa (`app/tests/ragnabot-fluxo-teste-nao-grava.test.mjs`). O que faltava era TELA: ninguém
// chegava nele porque não havia caminho, exatamente como aconteceu com o construtor de fluxo
// (doc 34 §F1.1). Este arquivo é a tela, e nada além dela.
//
// ⛔ O QUE EU DELIBERADAMENTE **NÃO** FIZ: reimplementar a marcha do fluxo no navegador. A própria
// rota diz por quê, e vale repetir: um simulador escrito à parte diverge do motor em três semanas,
// e a divergência aparece justamente quando alguém confia nele para publicar. Toda decisão de
// caminho, de casamento de resposta e de limite vem do servidor.
//
// ── AS DUAS SEPARAÇÕES QUE A TELA FAZ, E POR QUÊ ────────────────────────────────────────────────
// 1. O QUE O CLIENTE VERIA × O QUE ACONTECE NOS BASTIDORES. Etiqueta, carimbo, resolução e nota
//    interna NÃO são mensagens. Numa lista única, o operador contaria cinco balões numa conversa
//    que tem dois — e "corrigiria" um envio repetido que não existe.
// 2. ERRO × AVISO. Só o erro trava a publicação. Uma tela que grita igual para os dois ensina o
//    operador a ignorar os dois.
//
// ── OS COMPONENTES SÃO PUROS DE PROPÓSITO ───────────────────────────────────────────────────────
// `Balao`, `LinhaDeBastidor`, `PainelDeResposta`, `ListaDeVariaveis` e `SeletorDeFluxo` recebem
// tudo por propriedade e não tocam a rede. É o que permite medi-los com `renderToString`, sem
// navegador (`web/tests/testador.smoke.mjs`). Só o componente de baixo conversa com o servidor.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FlaskConical, Play, RotateCcw, Send } from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
import { Etiqueta, Faixa, Rotulo, T, Vazio, campoEstilo, cartao } from './EmpresaFormulario.jsx';
import {
  AVISO_DE_SIMULACAO, listarFluxos, opcoesDoParado, passoDoTeste, respostaDeOpcao,
  resumirIntencao, rotuloDoFim, separarProblemas, variaveisEmLista,
} from '../lib/api-testador.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. TIJOLOS
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A FAIXA QUE NÃO PODE SUMIR.
 *
 * O dono pediu o testador para conferir fluxo antes de expor cliente. Uma tela que se parece com a
 * conversa real e não avisa que é ensaio é a receita para alguém jurar que "mandou a mensagem" —
 * ou, pior, para alguém achar que o cliente já foi avisado. Por isso o aviso fica FIXO no topo do
 * painel, e não num rodapé que a rolagem esconde.
 */
export function SeloDeSimulacao({ compacto = false }) {
  return (
    <div
      data-selo="simulacao"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: compacto ? '6px 10px' : '10px 12px',
        borderRadius: 10, border: `1px solid ${T.aviso}`, background: T.avisoDim,
        color: T.ink, fontSize: '0.8rem', fontWeight: 700,
      }}
    >
      <FlaskConical size={16} style={{ color: T.aviso, flexShrink: 0 }} />
      <span>SIMULAÇÃO — {AVISO_DE_SIMULACAO}</span>
    </div>
  );
}

/** Uma mensagem como o cliente a receberia. */
export function Balao({ resumo }) {
  return (
    <div style={{
      alignSelf: 'flex-start', maxWidth: '86%', background: T.sup, border: `1px solid ${T.borda}`,
      borderRadius: '12px 12px 12px 4px', padding: '10px 12px', color: T.ink, fontSize: '0.86rem',
    }}>
      <div style={{ marginBottom: 6 }}><Etiqueta tom="info">{resumo.rotulo}</Etiqueta></div>
      {resumo.texto
        ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{resumo.texto}</div>
        : <div style={{ color: T.mut, fontStyle: 'italic' }}>(sem texto)</div>}
      {resumo.opcoes.length ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {resumo.opcoes.map((o, i) => (
            <li key={o.id} style={{
              border: `1px solid ${T.borda2}`, borderRadius: 8, padding: '6px 10px', marginTop: 6,
              display: 'flex', gap: 8, alignItems: 'baseline',
            }}>
              <span style={{ color: T.mut, fontWeight: 700 }}>{i + 1}.</span>
              <span>
                {o.rotulo}
                {o.descricao ? <span style={{ color: T.mut }}> — {o.descricao}</span> : null}
                {o.url ? <span style={{ color: T.mut }}> ({o.url})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resumo.detalhes.length ? (
        <dl style={{ margin: '10px 0 0', fontSize: '0.78rem', color: T.sec }}>
          {resumo.detalhes.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 6 }}>
              <dt style={{ color: T.mut }}>{k}:</dt>
              <dd style={{ margin: 0, wordBreak: 'break-word' }}>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Uma ação de bastidor: etiqueta, carimbo, transferência, nota interna, chamada externa. */
export function LinhaDeBastidor({ resumo }) {
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderRadius: 8,
      border: `1px dashed ${T.borda}`, color: T.sec, fontSize: '0.78rem',
    }}>
      <Etiqueta tom="neutro">{resumo.rotulo}</Etiqueta>
      <span style={{ minWidth: 0 }}>
        {resumo.texto ? <span style={{ whiteSpace: 'pre-wrap' }}>{resumo.texto} </span> : null}
        {resumo.detalhes.map(([k, v]) => <span key={k} style={{ marginRight: 10 }}>{k}: <b>{v}</b></span>)}
      </span>
    </div>
  );
}

/** O que o operador responde agora — ou por que não há o que responder. */
export function PainelDeResposta({ parado, fim, aoResponder = () => {}, aoDigitar = () => {}, digitado = '', ocupado = false }) {
  if (fim) {
    const r = rotuloDoFim(fim);
    return (
      <div style={{ marginTop: 12 }}>
        <Faixa tom={r.tom} titulo="Fim da simulação">
          {r.frase}{r.detalhe ? ` ${r.detalhe}` : ''}
        </Faixa>
      </div>
    );
  }
  if (!parado) return null;

  const opcoes = opcoesDoParado(parado);
  if (parado.motivo === 'temporizador') {
    return (
      <div style={{ marginTop: 12 }}>
        <Faixa tom="info" titulo="O fluxo está esperando o relógio">
          Na conversa real ele seguiria sozinho quando o prazo vencesse
          {parado.saidaAoVencer ? `, pela saída "${parado.saidaAoVencer}"` : ''}. O testador não
          adianta o relógio: adiantar aqui mostraria um caminho que a produção percorre em outra hora.
        </Faixa>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Rotulo dica="é o que o cliente responderia">Responder como o cliente</Rotulo>
      {opcoes.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {opcoes.map((o, i) => (
            <button
              key={o.id}
              type="button"
              disabled={ocupado}
              onClick={() => aoResponder(respostaDeOpcao(o.id))}
              style={{
                padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.borda2}`,
                background: T.sup, color: T.ink, fontSize: '0.82rem', cursor: 'pointer',
              }}
            >{i + 1}. {o.rotulo}</button>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={digitado}
          placeholder={opcoes.length ? '…ou digite, como o cliente digitaria' : 'digite a resposta do cliente'}
          onChange={(ev) => aoDigitar(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && digitado.trim()) aoResponder(digitado); }}
          style={{ ...campoEstilo, flex: 1 }}
        />
        <button
          type="button"
          disabled={ocupado || !digitado.trim()}
          onClick={() => aoResponder(digitado)}
          style={{
            padding: '9px 14px', borderRadius: 8, border: 'none', background: T.primaria,
            color: 'var(--on-primary)', fontWeight: 700, fontSize: '0.82rem',
            cursor: ocupado || !digitado.trim() ? 'not-allowed' : 'pointer', opacity: ocupado || !digitado.trim() ? 0.5 : 1,
          }}
        ><Send size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Enviar</button>
      </div>
      {opcoes.length ? (
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: T.mut }}>
          Tocar no botão é o mesmo que o cliente tocar na opção. Digitar o número, o título ou um
          apelido passa pela mesma escada de casamento da conversa real.
        </div>
      ) : null}
    </div>
  );
}

/** As variáveis da conversa, que é o que explica por que o fluxo foi por um lado e não pelo outro. */
export function ListaDeVariaveis({ vars, aoAcrescentar = null }) {
  const lista = variaveisEmLista(vars);
  return (
    <div style={{ ...cartao, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 8 }}>Variáveis da conversa</div>
      {lista.length ? (
        <dl style={{ margin: 0, fontSize: '0.8rem' }}>
          {lista.map(([nome, valor]) => (
            <div key={nome} style={{ display: 'flex', gap: 6, padding: '3px 0', borderBottom: `1px solid ${T.borda}` }}>
              <dt style={{ color: T.mut, minWidth: 120 }}>{nome}</dt>
              <dd style={{ margin: 0, wordBreak: 'break-word' }}>{valor || <span style={{ color: T.mut }}>(vazia)</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div style={{ color: T.mut, fontSize: '0.8rem' }}>
          Nenhuma variável ainda. Elas nascem do que o cliente responde e do que os blocos calculam.
        </div>
      )}
      {aoAcrescentar}
    </div>
  );
}

/** Escolher qual fluxo testar. Sem lista, o operador teria de decorar identificador. */
export function SeletorDeFluxo({ fluxos = [], escolhido = null, aoEscolher = () => {}, carregando = false }) {
  if (carregando) return <Vazio>Carregando os seus fluxos…</Vazio>;
  if (!fluxos.length) {
    return (
      <Vazio>
        Nenhum fluxo cadastrado ainda. Crie um em <b>Fluxos</b> e volte aqui para conferir como ele
        se comporta antes de qualquer cliente falar com ele.
      </Vazio>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
      {fluxos.map((f) => (
        <button
          key={f.id}
          type="button"
          data-fluxo={f.id}
          onClick={() => aoEscolher(f)}
          style={{
            ...cartao, padding: 12, textAlign: 'left', cursor: 'pointer',
            borderColor: escolhido?.id === f.id ? T.primaria : T.borda,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>{f.nome || f.id}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Etiqueta tom={f.estado === 'publicado' ? 'ok' : 'neutro'}>{f.estado || 'rascunho'}</Etiqueta>
            {f.versaoPublicadaId ? <Etiqueta tom="info">tem versão publicada</Etiqueta> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

/** Os problemas que o teste encontrou. Erro e aviso separados — ver a nota do cabeçalho. */
export function ListaDeProblemas({ problemas }) {
  const { erros, avisos } = separarProblemas(problemas);
  if (!erros.length && !avisos.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      {erros.map((p, i) => (
        <Faixa key={`e${i}`} tom="erro" titulo={p.campo ? `Problema em ${p.campo}` : 'Problema'}>
          {p.mensagem}{p.comoCorrigir ? <div style={{ marginTop: 4 }}><b>Como corrigir:</b> {p.comoCorrigir}</div> : null}
        </Faixa>
      ))}
      {avisos.map((p, i) => (
        <Faixa key={`a${i}`} tom="aviso" titulo={p.campo ? `Aviso em ${p.campo}` : 'Aviso'}>
          {p.mensagem}
        </Faixa>
      ))}
    </div>
  );
}

/** A conversa simulada: balões do cliente à esquerda, bastidores em linha tracejada. */
export function Conversa({ saidas = [] }) {
  const resumos = saidas.map((s) => resumirIntencao(s));
  if (!resumos.length) {
    return <Vazio>Nada sairia neste passo. É o caso normal de blocos que só decidem caminho (condição, variável).</Vazio>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {resumos.map((r, i) => (r.paraOCliente
        ? <Balao key={i} resumo={r} />
        : <LinhaDeBastidor key={i} resumo={r} />))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────
export default function TestadorDeFluxo() {
  const { fluxoId } = useParams();
  const navegar = useNavigate();

  const [fluxos, setFluxos] = useState([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [erroDeRede, setErroDeRede] = useState(null);

  const [origem, setOrigem] = useState('rascunho');
  const [passos, setPassos] = useState([]);       // [{saidas, parado, fim, problemas, trilha}]
  const [estado, setEstado] = useState(null);
  const [digitado, setDigitado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [varsIniciais, setVarsIniciais] = useState('');
  // Saídas FORÇADAS, no formato `no_id=saida`, uma por linha. É como o testador percorre o ramo que
  // o motor não tomaria hoje — o outro lado de um randomizador (contrato S3, §F3.5) ou o `falso` de
  // uma condição cujos dados de teste não satisfazem. Sem isso, testar um fluxo com teste A/B
  // aprovaria metade dele e chamaria isso de aprovação.
  const [saidasForcadas, setSaidasForcadas] = useState('');

  useEffect(() => {
    let vivo = true;
    listarFluxos({ limite: 200 })
      .then((r) => { if (vivo) { setFluxos(r.itens); setCarregandoLista(false); } })
      .catch((e) => { if (vivo) { setErroDeRede(e.message); setCarregandoLista(false); } });
    return () => { vivo = false; };
  }, []);

  const escolhido = useMemo(() => fluxos.find((f) => f.id === fluxoId) || null, [fluxos, fluxoId]);
  const ultimo = passos[passos.length - 1] || null;

  const reiniciar = useCallback(() => { setPassos([]); setEstado(null); setDigitado(''); setErroDeRede(null); }, []);

  /** `no_id=saida` por linha → `{ no_id: 'saida' }`. Mesmo formato simples das variáveis. */
  const forcarSaidas = useMemo(() => {
    const mapa = {};
    for (const linha of String(saidasForcadas).split('\n')) {
      const corte = linha.indexOf('=');
      if (corte > 0) mapa[linha.slice(0, corte).trim()] = linha.slice(corte + 1).trim();
    }
    return mapa;
  }, [saidasForcadas]);

  const dar = useCallback(async (opcoes) => {
    if (!fluxoId) return;
    setOcupado(true);
    setErroDeRede(null);
    try {
      const r = await passoDoTeste(fluxoId, { origem, forcarSaidas, ...opcoes });
      setPassos((p) => [...p, r]);
      setEstado(r.estado || null);
      setDigitado('');
    } catch (e) {
      setErroDeRede(e.message);
    } finally {
      setOcupado(false);
    }
  }, [fluxoId, origem, forcarSaidas]);

  const comecar = useCallback(() => {
    reiniciar();
    let vars = null;
    if (varsIniciais.trim()) {
      // Formato deliberadamente simples (`nome=Ana`, uma por linha): JSON num campo de tela é
      // convite a erro de vírgula, e o operador que testa fluxo não é quem escreve JSON.
      vars = {};
      for (const linha of varsIniciais.split('\n')) {
        const corte = linha.indexOf('=');
        if (corte > 0) vars[linha.slice(0, corte).trim()] = linha.slice(corte + 1).trim();
      }
    }
    dar({ vars });
  }, [dar, reiniciar, varsIniciais]);

  // ── Escolha do fluxo ──────────────────────────────────────────────────────────────────────────
  if (!fluxoId) {
    return (
      <div>
        <CapaSecao
          secao="operacao"
          olho="Fluxos"
          titulo="Testador de fluxo"
          apoio="Converse com o seu fluxo antes de qualquer cliente conversar com ele."
        />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <SeloDeSimulacao />
          {erroDeRede ? <Faixa tom="erro" titulo="Não consegui falar com o servidor">{erroDeRede}</Faixa> : null}
          <SeletorDeFluxo
            fluxos={fluxos}
            carregando={carregandoLista}
            aoEscolher={(f) => navegar(`/testador/${encodeURIComponent(f.id)}`)}
          />
        </div>
      </div>
    );
  }

  // ── A simulação ───────────────────────────────────────────────────────────────────────────────
  return (
    <div>
      <CapaSecao
        secao="operacao"
        olho="Fluxos"
        titulo={`Testando: ${escolhido?.nome || fluxoId}`}
        apoio="Passo a passo, com o que sairia, as variáveis e as saídas possíveis."
        acoes={(
          <button
            type="button"
            onClick={() => navegar('/testador')}
            style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.borda2}`, background: 'transparent', color: T.ink, cursor: 'pointer', fontSize: '0.8rem' }}
          >Trocar de fluxo</button>
        )}
      />

      <div style={{ display: 'grid', gap: 12, marginTop: 16, gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)' }}>
        <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <SeloDeSimulacao />

          {erroDeRede ? <Faixa tom="erro" titulo="Não consegui falar com o servidor">{erroDeRede}</Faixa> : null}

          {!passos.length ? (
            <div style={{ ...cartao }}>
              <Rotulo dica="o que está no editor agora, ou a versão que está no ar">De onde testar</Rotulo>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {[['rascunho', 'Rascunho (o que estou editando)'], ['versao', 'Versão publicada']].map(([v, r]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setOrigem(v)}
                    style={{
                      padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer',
                      border: `1px solid ${origem === v ? T.primaria : T.borda2}`,
                      background: origem === v ? T.okDim : 'transparent', color: T.ink,
                    }}
                  >{r}</button>
                ))}
              </div>

              <Rotulo dica="uma por linha, no formato nome=valor. Opcional.">Variáveis para começar</Rotulo>
              <textarea
                value={varsIniciais}
                onChange={(ev) => setVarsIniciais(ev.target.value)}
                rows={3}
                placeholder={'nome=Ana\nplano=vip'}
                style={{ ...campoEstilo, fontFamily: 'monospace', minHeight: 72 }}
              />

              <Rotulo dica="uma por linha, no formato bloco=saida. Serve para percorrer o outro lado de um randomizador ou de uma condição. Opcional.">
                Forçar caminho
              </Rotulo>
              <textarea
                value={saidasForcadas}
                onChange={(ev) => setSaidasForcadas(ev.target.value)}
                rows={2}
                placeholder={'no_randomizador=b\nno_condicao=falso'}
                style={{ ...campoEstilo, fontFamily: 'monospace', minHeight: 56 }}
              />
              <div style={{ fontSize: '0.74rem', color: T.mut, marginTop: -4 }}>
                O randomizador sorteia sempre o MESMO ramo para a mesma conversa — é o que impede um
                cliente de receber as duas variantes. Aqui é onde você vê a outra.
              </div>

              <button
                type="button"
                onClick={comecar}
                disabled={ocupado}
                style={{
                  marginTop: 12, padding: '10px 16px', borderRadius: 8, border: 'none',
                  background: T.primaria, color: 'var(--on-primary)', fontWeight: 700, cursor: 'pointer',
                }}
              ><Play size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Começar a simulação</button>
            </div>
          ) : null}

          {passos.map((p, i) => (
            <div key={i} style={{ ...cartao }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Etiqueta tom="neutro">Passo {i + 1}</Etiqueta>
                {p.origem ? <span style={{ color: T.mut, fontSize: '0.75rem' }}>origem: {p.origem}</span> : null}
              </div>
              <Conversa saidas={p.saidas} />
              {p.forcadas?.length ? (
                <div style={{
                  margin: '10px 0', padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${T.aviso}`, background: 'var(--aviso-dim, transparent)',
                  color: T.ink, fontSize: '0.78rem',
                }}>
                  <b>Este caminho foi desviado por você.</b>{' '}
                  {p.forcadas.map((f) => `no "${f.noId}" o motor iria por "${f.sorteada}" e o teste foi por "${f.forcada}"`).join('; ')}.
                  Numa conversa real, quem decide é o motor.
                </div>
              ) : null}
              <ListaDeProblemas problemas={p.problemas} />
              {i === passos.length - 1 ? (
                <PainelDeResposta
                  parado={p.parado}
                  fim={p.fim}
                  digitado={digitado}
                  ocupado={ocupado}
                  aoDigitar={setDigitado}
                  aoResponder={(resposta) => dar({ estado, resposta })}
                />
              ) : null}
            </div>
          ))}

          {passos.length ? (
            <button
              type="button"
              onClick={reiniciar}
              style={{ justifySelf: 'start', padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.borda2}`, background: 'transparent', color: T.ink, cursor: 'pointer', fontSize: '0.8rem' }}
            ><RotateCcw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Recomeçar do início</button>
          ) : null}
        </div>

        <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <ListaDeVariaveis vars={estado?.vars || {}} />
          {ultimo?.trilha?.length ? (
            <div style={{ ...cartao, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 8 }}>Por onde passou</div>
              <ol style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: T.sec }}>
                {ultimo.trilha.map(([no, saida], i) => (
                  <li key={i} style={{ marginBottom: 2 }}><b>{no}</b> → {saida}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {ultimo?.limites ? (
            <div style={{ ...cartao, padding: 12, fontSize: '0.75rem', color: T.mut }}>
              Limites conferidos com o perfil <b>{ultimo.limites.perfil}</b> (origem:{' '}
              {ultimo.limites.origem === 'medido' ? 'medição' : 'documentação da Meta'}). Enquanto a
              origem for documentação, o teto é aplicado pelo pior caso.
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
