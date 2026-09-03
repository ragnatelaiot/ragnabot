// ════════════════════════════════════════════════════════════════════════════════════════════════
// AGENDAMENTO DE MENSAGENS — a tela (contrato S4, 02/09/2026 · doc 34 §F4.6)
//
// ⚠️ ESTA TELA NÃO DECIDE NADA. Quem sabe o que é recorrência válida, quando é a próxima ocorrência
// e o que pode ser editado é `services/ragnabot-agendamento.service.js`; quem dispara é
// `ragnabot-agendamento-worker.service.js`. Aqui só se junta o que já existe: montar o formulário,
// mostrar a lista com os filtros do contrato (período, status, recorrência) e — o que mais importa
// — mostrar o RESULTADO por destinatário, com o motivo escrito quando a mensagem não saiu.
//
// ── A DECISÃO DE DESENHO QUE MAIS IMPORTA AQUI ──────────────────────────────────────────────────
// Os sete estados de envio aparecem TODOS, com cor e explicação. A tentação é mostrar só
// «enviada / falhou» e esconder o resto num «outros» — e é assim que «fora da janela de 24 h» vira
// silêncio, que é justamente o que o contrato proíbe. «Em dúvida» tem lugar de destaque e um botão
// de reenvio, porque ele exige DECISÃO de gente: a máquina não repete o que não sabe se saiu.
//
// ── ⛔ O QUE EU DELIBERADAMENTE NÃO PUS, E POR QUÊ ──────────────────────────────────────────────
//   1. **Botão «disparar agora».** Ele pularia a reserva por chave — a única coisa que impede a
//      mensagem de sair duas vezes. Quem quiser antecipar, edita o horário. A rota também não
//      existe, de propósito.
//   2. **Escolher o contato numa lista da plataforma.** O cadastro de contatos do Chatwoot não tem
//      rota nossa de busca ainda (S6). Até lá, o destinatário é digitado/colado — e a tela mostra
//      a normalização («(98) 9 8335-1000 → 98983351000») para ninguém errar em silêncio.
//   3. **Upload de anexo.** Há campo de URL, que é o que o servidor aceita hoje (`enviarAnexo` da
//      porta busca a URL e monta o multipart). Balde próprio por empresa é decisão de outra frente.
//   As três ficam DITAS na tela, para quem vier do chat atual não achar que sumiram.
//
// ── DO PONTO DE VISTA DE TESTE ──────────────────────────────────────────────────────────────────
// `ListaDeAgendamentos`, `LinhaDeAgendamento`, `HistoricoDeEnvios` e `FormularioDeAgendamento` são
// PUROS: recebem tudo por propriedade, não buscam nada, não chamam a rede. Só o componente de baixo
// (`Agendamentos`) conversa com o servidor.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock, CalendarClock, Pause, Play, Plus, RefreshCw, Search, Send, XCircle,
} from 'lucide-react';

import CapaSecao from '../componentes/CapaSecao.jsx';
// ⚠️ Os tijolos visuais moram em `EmpresaFormulario.jsx` porque foi lá que nasceram. Reusar é a
// regra da casa — «não reescreva o que já existe, estenda».
import {
  Campo, ErroDoServidor, Etiqueta, Faixa, Modal, Rotulo, T, Vazio, campoEstilo, cartao,
} from './EmpresaFormulario.jsx';
import {
  DIAS_SEMANA, LIMITES, RECORRENCIAS, STATUS_AGENDAMENTO, STATUS_ENVIO,
  cancelarAgendamento, criarAgendamento, fusoDoNavegador, historicoDoAgendamento,
  lerListaDeContatos, listarAgendamentos, noFuso, pausarAgendamento, paraISO, previaDaGrade,
  reenviarEnvio, retomarAgendamento,
} from '../lib/api-agendamento.js';

const FUSO_PADRAO = 'America/Fortaleza';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// TIJOLOS DESTA TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────

const botao = (tom = 'neutro') => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
  border: `1px solid ${tom === 'primaria' ? T.primaria : T.borda}`,
  background: tom === 'primaria' ? T.primaria : T.sup,
  color: tom === 'primaria' ? '#fff' : T.ink,
  fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
});

/** O selo do estado de UM envio, com a explicação no `title` — a cor sozinha não explica nada a
 *  quem chega na tela pela primeira vez, e «fora da janela» precisa ser explicado, não codificado. */
export function SeloDeEnvio({ status }) {
  const s = STATUS_ENVIO[status] || { rotulo: status, cor: T.mut, apoio: '' };
  return (
    <span title={s.apoio} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      border: `1px solid ${s.cor}`, color: s.cor, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>{s.rotulo}</span>
  );
}

/** Uma frase que descreve a recorrência em português, para a lista não obrigar a decifrar campos. */
export function descreverGrade(a) {
  const n = a.intervalo > 1 ? `a cada ${a.intervalo} ` : 'todo ';
  if (a.recorrencia === 'unica') return 'Uma vez só';
  if (a.recorrencia === 'diaria') return `${n}${a.intervalo > 1 ? 'dias' : 'dia'}`;
  if (a.recorrencia === 'mensal') return `${n}${a.intervalo > 1 ? 'meses' : 'mês'}`;
  if (a.recorrencia === 'semanal') {
    const dias = String(a.diasSemana || '').split(',').filter(Boolean)
      .map((d) => DIAS_SEMANA.find((x) => x.valor === Number(d))?.rotulo || d);
    const quando = dias.length ? dias.join(', ') : 'sem dia definido';
    return a.intervalo > 1 ? `a cada ${a.intervalo} semanas · ${quando}` : `toda semana · ${quando}`;
  }
  return a.recorrencia;
}

/** O resumo do último disparo, em uma linha. Sem ele a lista mentiria por omissão: um agendamento
 *  com 40 contatos e 3 falhas pareceria igual a um que deu tudo certo. */
export function ResumoDeEnvios({ resumo }) {
  const envios = resumo?.envios || {};
  const chaves = Object.keys(envios);
  if (!chaves.length) return <span style={{ color: T.mut, fontSize: '0.76rem' }}>ainda não disparou</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {chaves.map((k) => (
        <span key={k} style={{ fontSize: '0.72rem', color: STATUS_ENVIO[k]?.cor || T.mut, fontWeight: 700 }}
          title={STATUS_ENVIO[k]?.apoio || k}>
          {envios[k]} {STATUS_ENVIO[k]?.rotulo || k}
        </span>
      ))}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A LISTA
// ────────────────────────────────────────────────────────────────────────────────────────────────

export function LinhaDeAgendamento({ item, aoAbrir, aoPausar, aoRetomar, aoCancelar, ocupado }) {
  const st = STATUS_AGENDAMENTO[item.status] || { rotulo: item.status, cor: T.mut };
  return (
    <div style={{ ...cartao, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => aoAbrir(item)} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: T.ink, fontWeight: 800, fontSize: '0.98rem', textAlign: 'left',
        }}>{item.titulo}</button>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: st.cor }}>{st.rotulo}</span>
        <Etiqueta tom="neutro">{descreverGrade(item)}</Etiqueta>
        <Etiqueta tom="neutro" titulo="A conexão por onde a mensagem sai">
          {item.caixaNome || `conexão ${item.cwInboxId}`}
        </Etiqueta>
        {item.abrirTicket ? <Etiqueta tom="info" titulo="Vira atendimento ao enviar">abre atendimento</Etiqueta> : null}
        {item.usarTemplate ? <Etiqueta tom="aviso" titulo="Sai por modelo aprovado quando a janela de 24 h estiver fechada">modelo Meta</Etiqueta> : null}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.78rem', color: T.sec }}>
        <span title="No fuso do agendamento — que é o relógio do cliente, não o do seu navegador">
          <CalendarClock size={13} style={{ verticalAlign: -2 }} />{' '}
          {item.proximaEm ? `próxima: ${noFuso(item.proximaEm, item.fuso)}` : 'sem próxima ocorrência'}
          {' '}<span style={{ color: T.mut }}>({item.fuso})</span>
        </span>
        <span>{item.resumo?.destinos ?? 0} destinatário(s)</span>
        <span>{item.ocorrenciasFeitas ?? 0} disparo(s)</span>
        <ResumoDeEnvios resumo={item.resumo} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={botao()} onClick={() => aoAbrir(item)}>Ver o que aconteceu</button>
        {item.status === 'pendente' ? (
          <button type="button" style={botao()} disabled={ocupado} onClick={() => aoPausar(item)}>
            <Pause size={14} /> Pausar
          </button>
        ) : null}
        {item.status === 'pausado' ? (
          <button type="button" style={botao()} disabled={ocupado} onClick={() => aoRetomar(item)}>
            <Play size={14} /> Retomar
          </button>
        ) : null}
        {item.status !== 'cancelado' && item.status !== 'concluido' ? (
          <button type="button" style={botao()} disabled={ocupado} onClick={() => aoCancelar(item)}>
            <XCircle size={14} /> Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ListaDeAgendamentos({ itens, ...resto }) {
  if (!itens?.length) {
    return <Vazio>Nenhum agendamento com estes filtros. Crie o primeiro no botão «Novo agendamento».</Vazio>;
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {itens.map((i) => <LinhaDeAgendamento key={i.id} item={i} {...resto} />)}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O HISTÓRICO — «status por item» (F4.6). É a parte da tela que responde «essa mensagem saiu?»
// ────────────────────────────────────────────────────────────────────────────────────────────────

export function HistoricoDeEnvios({ envios, fuso, aoReenviar, ocupado }) {
  if (!envios?.length) return <Vazio>Este agendamento ainda não disparou.</Vazio>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {envios.map((e) => (
        <div key={e.id} style={{
          border: `1px solid ${T.borda}`, borderRadius: 10, padding: 10, display: 'grid', gap: 6,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <SeloDeEnvio status={e.status} />
            <b style={{ fontSize: '0.85rem' }}>{e.contatoNome || e.contatoChave || '—'}</b>
            <span style={{ fontSize: '0.75rem', color: T.mut }}>{noFuso(e.ocorrenciaEm, fuso)}</span>
            {e.tentativaManual > 0 ? <Etiqueta tom="info">reenvio manual nº {e.tentativaManual}</Etiqueta> : null}
            {e.degradado ? <Etiqueta tom="aviso" titulo="O canal não suporta o formato original">{e.degradado}</Etiqueta> : null}
          </div>
          {/* ⚠️ O MOTIVO APARECE SEMPRE que existe. É a diferença entre «não saiu» e «não saiu, e
              foi por isto» — e é o que o contrato chama de «nunca falhar em silêncio». */}
          {e.erro ? <div style={{ fontSize: '0.78rem', color: T.sec }}>{e.erro}</div> : null}
          {['duvidoso', 'falhou', 'sem_janela'].includes(e.status) ? (
            <div>
              <button type="button" style={botao()} disabled={ocupado} onClick={() => aoReenviar(e)}>
                <Send size={13} /> Reenviar este
              </button>
              <span style={{ fontSize: '0.74rem', color: T.mut, marginLeft: 8 }}>
                a tentativa antiga fica no histórico
              </span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// O FORMULÁRIO
// ────────────────────────────────────────────────────────────────────────────────────────────────

const VAZIO = {
  titulo: '', mensagem: '', cwAccountId: '', cwInboxId: '', cwTeamId: '',
  destinosTexto: '', anexoUrl: '', abrirTicket: true,
  fuso: FUSO_PADRAO, recorrencia: 'unica', intervalo: 1, diasSemana: [],
  inicioEm: '', ateEm: '', maxOcorrencias: '',
  usarTemplate: false, templateNome: '', templateIdioma: 'pt_BR',
};

export function FormularioDeAgendamento({ valor, aoMudar, erro, previa, aoPedirPrevia }) {
  const v = valor;
  const set = (campo) => (novo) => aoMudar({ ...v, [campo]: novo });
  const contatos = useMemo(() => lerListaDeContatos(v.destinosTexto), [v.destinosTexto]);
  const fusoNav = fusoDoNavegador();

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <ErroDoServidor erro={erro} />

      <Campo rotulo="Nome do agendamento" dica="é como você vai achá-lo na lista"
        valor={v.titulo} aoMudar={set('titulo')} maxLength={LIMITES.titulo} />

      <div style={{ marginBottom: 12 }}>
        <Rotulo dica="o que será enviado">Mensagem</Rotulo>
        <textarea value={v.mensagem} onChange={(ev) => set('mensagem')(ev.target.value)}
          rows={4} maxLength={LIMITES.mensagem} style={{ ...campoEstilo, minHeight: 90, resize: 'vertical' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Campo rotulo="Conta na plataforma" dica="cwAccountId" tipo="number"
          valor={v.cwAccountId} aoMudar={set('cwAccountId')} />
        <Campo rotulo="Conexão" dica="obrigatória — sem canal a mensagem não sai" tipo="number"
          valor={v.cwInboxId} aoMudar={set('cwInboxId')} />
        <Campo rotulo="Setor" dica="opcional" tipo="number" valor={v.cwTeamId} aoMudar={set('cwTeamId')} />
      </div>

      {/* ── Destinatários (F4.3) ───────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 12 }}>
        <Rotulo dica="um por linha, ou separados por vírgula">Destinatários</Rotulo>
        <textarea value={v.destinosTexto} onChange={(ev) => set('destinosTexto')(ev.target.value)}
          rows={3} placeholder={'5598983351000\n(98) 9 8335-1000'}
          style={{ ...campoEstilo, minHeight: 70, resize: 'vertical', fontFamily: 'monospace' }} />
        <div style={{ marginTop: 4, fontSize: '0.75rem', color: T.mut }}>
          {contatos.bons.length} contato(s) válido(s){contatos.bons.length ? `: ${contatos.bons.join(' · ')}` : ''}
          {contatos.ruins.length ? (
            <div style={{ color: T.perigo }}>
              {contatos.ruins.map((r) => `«${r.entrada}» — ${r.erro}`).join(' · ')}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Quando (F4.1) e recorrência (F4.2) ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Campo rotulo="Primeiro envio" tipo="datetime-local" valor={v.inicioEm} aoMudar={set('inicioEm')} />
        <div style={{ marginBottom: 12 }}>
          <Rotulo dica="o relógio do CLIENTE, não o seu">Fuso</Rotulo>
          <input value={v.fuso} onChange={(ev) => set('fuso')(ev.target.value)} style={campoEstilo} />
          {fusoNav && fusoNav !== v.fuso ? (
            <div style={{ marginTop: 4, fontSize: '0.74rem', color: T.aviso }}>
              O seu navegador está em {fusoNav}. A hora acima será interpretada no fuso do agendamento.
            </div>
          ) : null}
        </div>
        <div style={{ marginBottom: 12 }}>
          <Rotulo>Repetição</Rotulo>
          <select value={v.recorrencia} onChange={(ev) => set('recorrencia')(ev.target.value)} style={campoEstilo}>
            {RECORRENCIAS.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
          </select>
        </div>
      </div>

      {v.recorrencia !== 'unica' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Campo rotulo="A cada" dica={v.recorrencia === 'diaria' ? 'dias' : v.recorrencia === 'semanal' ? 'semanas' : 'meses'}
            tipo="number" min={1} max={LIMITES.intervalo} valor={v.intervalo} aoMudar={(x) => set('intervalo')(Number(x))} />
          <Campo rotulo="Repetir até" dica="opcional" tipo="datetime-local" valor={v.ateEm} aoMudar={set('ateEm')} />
          <Campo rotulo="No máximo N vezes" dica="opcional" tipo="number" min={1}
            valor={v.maxOcorrencias} aoMudar={set('maxOcorrencias')} />
        </div>
      ) : null}

      {v.recorrencia === 'semanal' ? (
        <div style={{ marginBottom: 12 }}>
          <Rotulo>Dias da semana</Rotulo>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DIAS_SEMANA.map((d) => {
              const ativo = v.diasSemana.includes(d.valor);
              return (
                <button key={d.valor} type="button"
                  onClick={() => set('diasSemana')(ativo
                    ? v.diasSemana.filter((x) => x !== d.valor)
                    : [...v.diasSemana, d.valor].sort((a, b) => a - b))}
                  style={{ ...botao(ativo ? 'primaria' : 'neutro'), padding: '6px 10px' }}>{d.rotulo}</button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ⚠️ A PRÉVIA DA GRADE. Recorrência é a configuração que mais se erra em silêncio: «a cada 2
          semanas, terça e quinta» tem uma resposta certa, e sem ver as datas a pessoa só descobre
          que errou quando o cliente reclama. */}
      {v.recorrencia !== 'unica' && v.inicioEm ? (
        <div style={{ marginBottom: 12 }}>
          <button type="button" style={botao()} onClick={aoPedirPrevia}>
            <AlarmClock size={14} /> Ver as próximas datas
          </button>
          {previa?.length ? (
            <div style={{ marginTop: 6, fontSize: '0.78rem', color: T.sec }}>
              {previa.map((d) => noFuso(d, v.fuso)).join('  ·  ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Anexo (F4.5) e ticket (F4.4) ──────────────────────────────────────────────────── */}
      <Campo rotulo="Anexo (URL)" dica="opcional — o arquivo é buscado e enviado como mídia; a mensagem vira a legenda"
        valor={v.anexoUrl} aoMudar={set('anexoUrl')} placeholder="https://…" />

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: '0.85rem' }}>
        <input type="checkbox" checked={v.abrirTicket} onChange={(ev) => set('abrirTicket')(ev.target.checked)} />
        Abrir atendimento ao enviar
        <span style={{ color: T.mut, fontSize: '0.76rem' }}>
          (desmarcado, a conversa que NÓS abrirmos é resolvida logo depois — nunca a que já existia)
        </span>
      </label>

      {/* ── Fora da janela de 24 h ────────────────────────────────────────────────────────── */}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: '0.85rem' }}>
        <input type="checkbox" checked={v.usarTemplate} onChange={(ev) => set('usarTemplate')(ev.target.checked)} />
        Usar modelo aprovado da Meta quando o contato estiver fora da janela de 24 h
      </label>
      {v.usarTemplate ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Campo rotulo="Nome do modelo" valor={v.templateNome} aoMudar={set('templateNome')} />
          <Campo rotulo="Idioma" valor={v.templateIdioma} aoMudar={set('templateIdioma')} />
        </div>
      ) : (
        <Faixa tom="aviso" titulo="Sem modelo aprovado">
          Se o contato estiver fora da janela de 24 h do WhatsApp, a mensagem <b>não será enviada</b> —
          e o item ficará registrado como «fora da janela», com o motivo escrito. Nada some em silêncio.
        </Faixa>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A TELA
// ────────────────────────────────────────────────────────────────────────────────────────────────

export default function Agendamentos() {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const [filtros, setFiltros] = useState({ busca: '', status: '', recorrencia: '', de: '', ate: '' });

  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [erroForm, setErroForm] = useState(null);
  const [previa, setPrevia] = useState([]);

  const [detalhe, setDetalhe] = useState(null); // { agendamento, envios }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroLista(null);
    try {
      const r = await listarAgendamentos({
        busca: filtros.busca || undefined,
        status: filtros.status || undefined,
        recorrencia: filtros.recorrencia || undefined,
        de: filtros.de ? paraISO(filtros.de) : undefined,
        ate: filtros.ate ? paraISO(filtros.ate) : undefined,
      });
      setItens(r.itens || []);
    } catch (e) {
      setErroLista(e);
    } finally {
      setCarregando(false);
    }
  }, [filtros]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirDetalhe = useCallback(async (item) => {
    setDetalhe({ agendamento: item, envios: null });
    try {
      const r = await historicoDoAgendamento(item.id);
      setDetalhe({ agendamento: item, envios: r.envios || [] });
    } catch (e) {
      setDetalhe({ agendamento: item, envios: [], erro: e });
    }
  }, []);

  const comOcupado = useCallback(async (fn) => {
    setOcupado(true);
    try { await fn(); await carregar(); } catch (e) { setErroLista(e); } finally { setOcupado(false); }
  }, [carregar]);

  const salvar = useCallback(async () => {
    setErroForm(null);
    try {
      const contatos = lerListaDeContatos(form.destinosTexto);
      const corpo = {
        titulo: form.titulo,
        mensagem: form.mensagem,
        cwAccountId: Number(form.cwAccountId),
        cwInboxId: Number(form.cwInboxId),
        cwTeamId: form.cwTeamId === '' ? null : Number(form.cwTeamId),
        destinos: contatos.bons,
        anexoUrl: form.anexoUrl || null,
        abrirTicket: form.abrirTicket,
        fuso: form.fuso,
        recorrencia: form.recorrencia,
        intervalo: Number(form.intervalo) || 1,
        diasSemana: form.recorrencia === 'semanal' ? form.diasSemana.join(',') : null,
        inicioEm: paraISO(form.inicioEm),
        ateEm: form.ateEm ? paraISO(form.ateEm) : null,
        maxOcorrencias: form.maxOcorrencias === '' ? null : Number(form.maxOcorrencias),
        usarTemplate: form.usarTemplate,
        templateNome: form.templateNome || null,
        templateIdioma: form.templateIdioma || 'pt_BR',
      };
      await criarAgendamento(corpo);
      setFormAberto(false);
      setForm(VAZIO);
      setPrevia([]);
      await carregar();
    } catch (e) {
      setErroForm(e);
    }
  }, [form, carregar]);

  const pedirPrevia = useCallback(async () => {
    try {
      const r = await previaDaGrade({
        inicioEm: paraISO(form.inicioEm),
        fuso: form.fuso,
        recorrencia: form.recorrencia,
        intervalo: Number(form.intervalo) || 1,
        diasSemana: form.recorrencia === 'semanal' ? form.diasSemana.join(',') : null,
        minutoLocal: undefined, // o servidor deriva do `inicioEm`, no fuso do agendamento
        quantas: 6,
      });
      setPrevia(r.ocorrencias || []);
    } catch (e) {
      setErroForm(e);
    }
  }, [form]);

  return (
    <>
      <CapaSecao
        secao="operacao"
        olho="Atendimento"
        titulo="Agendamentos"
        apoio="Marcar uma mensagem para sair na hora certa — para um contato ou para muitos, uma vez ou repetindo."
        acoes={(
          <button type="button" style={botao('primaria')} onClick={() => { setForm(VAZIO); setErroForm(null); setPrevia([]); setFormAberto(true); }}>
            <Plus size={15} /> Novo agendamento
          </button>
        )}
      />

      <div style={{ display: 'grid', gap: 14, padding: 16 }}>
        {/* ── Filtros do contrato (F4.6): período, status, recorrência ───────────────────── */}
        <div style={{ ...cartao, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div>
            <Rotulo>Buscar</Rotulo>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: 13, color: T.mut }} />
              <input value={filtros.busca} onChange={(ev) => setFiltros({ ...filtros, busca: ev.target.value })}
                placeholder="nome do agendamento" style={{ ...campoEstilo, paddingLeft: 28 }} />
            </div>
          </div>
          <div>
            <Rotulo>Situação</Rotulo>
            <select value={filtros.status} onChange={(ev) => setFiltros({ ...filtros, status: ev.target.value })} style={campoEstilo}>
              <option value="">Todas</option>
              {Object.entries(STATUS_AGENDAMENTO).map(([k, s]) => <option key={k} value={k}>{s.rotulo}</option>)}
            </select>
          </div>
          <div>
            <Rotulo>Repetição</Rotulo>
            <select value={filtros.recorrencia} onChange={(ev) => setFiltros({ ...filtros, recorrencia: ev.target.value })} style={campoEstilo}>
              <option value="">Todas</option>
              {RECORRENCIAS.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
            </select>
          </div>
          <div>
            <Rotulo dica="pela próxima ocorrência">De</Rotulo>
            <input type="datetime-local" value={filtros.de} onChange={(ev) => setFiltros({ ...filtros, de: ev.target.value })} style={campoEstilo} />
          </div>
          <div>
            <Rotulo dica="pela próxima ocorrência">Até</Rotulo>
            <input type="datetime-local" value={filtros.ate} onChange={(ev) => setFiltros({ ...filtros, ate: ev.target.value })} style={campoEstilo} />
          </div>
        </div>

        <ErroDoServidor
          erro={erroLista}
          ajuda={erroLista?.code === 'MODELO_AUSENTE'
            ? 'A migração do agendamento ainda não foi aplicada neste ambiente, ou o serviço não foi reiniciado depois dela — o cliente do banco é carregado no arranque.'
            : undefined}
        />

        {carregando ? <Vazio>Carregando…</Vazio> : (
          <ListaDeAgendamentos
            itens={itens}
            ocupado={ocupado}
            aoAbrir={abrirDetalhe}
            aoPausar={(i) => comOcupado(() => pausarAgendamento(i.id))}
            aoRetomar={(i) => comOcupado(() => retomarAgendamento(i.id))}
            aoCancelar={(i) => comOcupado(() => cancelarAgendamento(i.id))}
          />
        )}

        <div style={{ fontSize: '0.76rem', color: T.mut }}>
          <RefreshCw size={12} style={{ verticalAlign: -2 }} />{' '}
          O disparo é feito por um trabalhador que confere as agendas vencidas a cada meia hora de
          relógio no máximo. A mesma mensagem nunca sai duas vezes para o mesmo contato numa mesma
          ocorrência, nem que o serviço reinicie no meio.
        </div>
      </div>

      {/* ── Novo agendamento ──────────────────────────────────────────────────────────────── */}
      <Modal aberta={formAberto} titulo="Novo agendamento" aoFechar={() => setFormAberto(false)} largura={720}
        rodape={(
          <>
            <button type="button" style={botao()} onClick={() => setFormAberto(false)}>Cancelar</button>
            <button type="button" style={botao('primaria')} onClick={salvar}>Agendar</button>
          </>
        )}>
        <FormularioDeAgendamento valor={form} aoMudar={setForm} erro={erroForm} previa={previa} aoPedirPrevia={pedirPrevia} />
      </Modal>

      {/* ── O que aconteceu ───────────────────────────────────────────────────────────────── */}
      <Modal aberta={Boolean(detalhe)} titulo={detalhe?.agendamento?.titulo || 'Agendamento'}
        aoFechar={() => setDetalhe(null)} largura={720}
        rodape={<button type="button" style={botao()} onClick={() => setDetalhe(null)}>Fechar</button>}>
        {detalhe ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: '0.82rem', color: T.sec }}>
              {descreverGrade(detalhe.agendamento)} ·{' '}
              {detalhe.agendamento.proximaEm
                ? `próxima em ${noFuso(detalhe.agendamento.proximaEm, detalhe.agendamento.fuso)}`
                : 'sem próxima ocorrência'}
            </div>
            <ErroDoServidor erro={detalhe.erro} />
            {detalhe.envios === null ? <Vazio>Carregando o histórico…</Vazio> : (
              <HistoricoDeEnvios
                envios={detalhe.envios}
                fuso={detalhe.agendamento.fuso}
                ocupado={ocupado}
                aoReenviar={(e) => comOcupado(async () => {
                  await reenviarEnvio(e.chave);
                  await abrirDetalhe(detalhe.agendamento);
                })}
              />
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
