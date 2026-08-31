// ════════════════════════════════════════════════════════════════════════════════════════════════
// FORMULÁRIO DE EMPRESA + as peças visuais que a tela de empresas usa
//
// Contrato S4-EMPRESAS (30/08/2026). Este arquivo é a METADE DE BAIXO da tela: os tijolos
// (etiqueta, faixa, vazio, modal, campo) e o formulário de cadastro. `Empresas.jsx` é a metade de
// cima e importa daqui. A dependência anda em UMA direção só — se este arquivo importasse de
// `Empresas.jsx` teríamos ciclo, e ciclo em ESM não estoura: ele entrega `undefined` no meio da
// montagem e o defeito aparece como "Element type is invalid", três telas depois da causa.
//
// ⚠️ OS TIJOLOS SÃO CÓPIA DECLARADA dos de `FluxosRagnabot.jsx`. Não importei de lá de propósito:
// aquele arquivo é autocontido por decisão registrada no cabeçalho dele e não exporta nada além do
// componente de página. Importar de dentro dele obrigaria a EDITÁ-LO — e ele é de outro dono agora.
// Quando alguém extrair os tijolos para `componentes/`, as duas telas trocam o import e este bloco
// morre. Até lá, cópia com o mesmo visual é honesto; visual diferente na tela ao lado não é.
//
// ── O QUE O SERVIDOR REALMENTE EXIGE (medido lendo `ragnabot-tenant.service.js`) ─────────────────
//   obrigatórios: nome (2-120) · slug (3-40, RE_SLUG) · contatoNome (2-120) · contatoEmail (RE_EMAIL)
//   com padrão:   plano (cai em «essencial» se vier vazio)
//   opcionais:    cnpj (só dígitos, corta em 14) · contatoWhatsapp (só dígitos, corta em 15)
//   aceitos, e NÃO expostos nesta tela: limitesOverride, retencaoDias — são contrato negociado, e
//   um campo livre de limites numa tela de cadastro é como se cria um plano que ninguém revisou.
//   ⚠️ `retencaoDias` só é aceito como NÚMERO no servidor (`Number.isFinite`): mandar "730" em
//   texto seria descartado em silêncio. Mais uma razão para não expor por enquanto.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import {
  EXPLICACAO_DO_SLUG, sugerirSlug, validarCadastro,
} from '../lib/api-empresas.js';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 0. TOKENS — zero cor literal, como no editor de fluxo. Quem manda é `estilos/tema.css`.
// ────────────────────────────────────────────────────────────────────────────────────────────────
export const T = {
  ink: 'var(--text-primary)', sec: 'var(--text-secondary)', mut: 'var(--text-muted)',
  borda: 'var(--border-primary)', borda2: 'var(--border-secondary)', campo: 'var(--border-campo)',
  cartaoBg: 'var(--bg-secondary)', sup: 'var(--bg-surface)', entrada: 'var(--bg-input)',
  primaria: 'var(--primary)',
  ok: 'var(--success)', aviso: 'var(--warning)', perigo: 'var(--danger)', info: 'var(--info)',
  okDim: 'var(--success-dim)', avisoDim: 'var(--warning-dim)',
  perigoDim: 'var(--danger-dim)', infoDim: 'var(--info-dim)',
};

export const cartao = {
  background: T.cartaoBg, border: `1px solid ${T.borda}`, borderRadius: 12, padding: 16, color: T.ink,
};

export const grade = (min) => ({
  display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12,
});

export const campoEstilo = {
  width: '100%', padding: '9px 10px', borderRadius: 8, background: T.entrada,
  border: `1px solid ${T.campo}`, color: T.ink, fontSize: '0.86rem', minHeight: 40,
};

const rotuloEstilo = {
  display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '.04em',
  color: T.mut, marginBottom: 4, fontWeight: 700,
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 1. TIJOLOS
// ────────────────────────────────────────────────────────────────────────────────────────────────

export function Etiqueta({ tom = 'neutro', children, titulo }) {
  const tons = {
    ok: { bg: T.okDim, fg: T.ok }, aviso: { bg: T.avisoDim, fg: T.aviso },
    erro: { bg: T.perigoDim, fg: T.perigo }, info: { bg: T.infoDim, fg: T.info },
    neutro: { bg: T.sup, fg: T.mut },
  };
  const t = tons[tom] || tons.neutro;
  return (
    <span title={titulo} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
      background: t.bg, color: t.fg, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/** Recado. O ÍCONE e a palavra dizem a mesma coisa que a cor — severidade nunca viaja só na cor. */
export function Faixa({ tom = 'info', titulo, children, acoes }) {
  const cores = {
    info: { borda: T.info, fundo: T.infoDim, Icone: Info },
    aviso: { borda: T.aviso, fundo: T.avisoDim, Icone: AlertTriangle },
    erro: { borda: T.perigo, fundo: T.perigoDim, Icone: AlertTriangle },
    ok: { borda: T.ok, fundo: T.okDim, Icone: CheckCircle },
  };
  const c = cores[tom] || cores.info;
  const { Icone } = c;
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10,
      border: `1px solid ${c.borda}`, background: c.fundo, color: T.ink, fontSize: '0.82rem',
    }}>
      <Icone size={16} style={{ flexShrink: 0, marginTop: 2, color: c.borda }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {titulo ? <div style={{ fontWeight: 800, marginBottom: 2 }}>{titulo}</div> : null}
        <div style={{ color: T.sec }}>{children}</div>
      </div>
      {acoes ? <div style={{ flexShrink: 0 }}>{acoes}</div> : null}
    </div>
  );
}

export function Vazio({ children }) {
  return (
    <div style={{
      padding: 20, textAlign: 'center', color: T.mut, fontSize: '0.85rem',
      border: `1px dashed ${T.borda}`, borderRadius: 10,
    }}>{children}</div>
  );
}

export function Rotulo({ children, dica }) {
  return (
    <label style={rotuloEstilo}>
      {children}
      {dica ? <span style={{ textTransform: 'none', fontWeight: 500, color: T.mut, marginLeft: 6 }}>{dica}</span> : null}
    </label>
  );
}

/**
 * Campo de texto com o erro COLADO nele.
 * A mensagem fica embaixo do campo que a causou, e não numa faixa no topo: erro no topo de um
 * formulário de sete campos obriga o operador a adivinhar qual campo o servidor recusou.
 */
export function Campo({ rotulo, dica, valor, aoMudar, erro, tipo = 'text', ...resto }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={dica}>{rotulo}</Rotulo>
      <input
        type={tipo}
        value={valor ?? ''}
        onChange={(ev) => aoMudar(ev.target.value)}
        aria-invalid={erro ? 'true' : undefined}
        style={{ ...campoEstilo, borderColor: erro ? T.perigo : T.campo }}
        {...resto}
      />
      {erro ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: T.perigo }}>{erro}</div> : null}
    </div>
  );
}

export function Selecao({ rotulo, dica, valor, opcoes, aoMudar, erro, vazio = '— escolha —' }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={dica}>{rotulo}</Rotulo>
      <select
        value={valor ?? ''}
        onChange={(ev) => aoMudar(ev.target.value)}
        style={{ ...campoEstilo, borderColor: erro ? T.perigo : T.campo }}
      >
        {vazio ? <option value="">{vazio}</option> : null}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {erro ? <div style={{ marginTop: 4, fontSize: '0.75rem', color: T.perigo }}>{erro}</div> : null}
    </div>
  );
}

export function Modal({ aberta, titulo, aoFechar, children, rodape, largura = 560 }) {
  useEffect(() => {
    if (!aberta) return undefined;
    const aoTeclar = (ev) => { if (ev.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberta, aoFechar]);
  if (!aberta) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={(ev) => { if (ev.target === ev.currentTarget) aoFechar(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        ...cartao, width: '100%', maxWidth: largura, maxHeight: '86vh',
        display: 'flex', flexDirection: 'column', padding: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `1px solid ${T.borda}` }}>
          <div style={{ flex: 1, fontWeight: 800 }}>{titulo}</div>
          <button className="btn btn-secondary" style={{ minHeight: 36 }} onClick={() => aoFechar()} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>{children}</div>
        {rodape ? (
          <div style={{ padding: 12, borderTop: `1px solid ${T.borda}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {rodape}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * O erro do servidor, legível.
 * Mostra a mensagem que o servidor mandou (elas já vêm em português e são boas), e SÓ ACRESCENTA a
 * ajuda de diagnóstico embaixo. Nunca troca uma pela outra: substituir a mensagem do servidor pela
 * nossa é como se esconde um erro novo dentro de um diagnóstico velho.
 */
export function ErroDoServidor({ erro, ajuda, titulo }) {
  if (!erro) return null;
  const tom = erro.local ? 'aviso' : 'erro';
  return (
    <Faixa tom={tom} titulo={titulo || (erro.local ? 'Confira o formulário' : 'O servidor recusou')}>
      {erro.message}
      {ajuda ? (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.borda}`, color: T.mut }}>
          <b style={{ color: T.sec }}>Por que isto acontece: </b>{ajuda}
        </div>
      ) : null}
    </Faixa>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// 2. O FORMULÁRIO — controlado e PURO: recebe tudo por props, não busca nada, não chama a rede.
//    É por isso que ele pode ser renderizado num teste sem navegador e sem servidor.
// ────────────────────────────────────────────────────────────────────────────────────────────────

export const CADASTRO_VAZIO = {
  nome: '', slug: '', cnpj: '', contatoNome: '', contatoEmail: '', contatoWhatsapp: '', plano: 'essencial',
};

export function FormularioDeEmpresa({ valores, aoMudar, erros = {}, planos = [], slugTocado, aoTocarSlug }) {
  const v = valores || CADASTRO_VAZIO;
  const mudar = (campo) => (novo) => aoMudar({ ...v, [campo]: novo });

  return (
    <div>
      <Campo
        rotulo="Nome da empresa" dica="2 a 120 caracteres" erro={erros.nome}
        valor={v.nome}
        aoMudar={(novo) => {
          // O identificador acompanha o nome ATÉ o operador mexer nele. Depois disso, para de
          // acompanhar: sobrescrever o que a pessoa digitou é o jeito mais rápido de ela deixar de
          // confiar no formulário.
          const proximo = { ...v, nome: novo };
          if (!slugTocado) proximo.slug = sugerirSlug(novo);
          aoMudar(proximo);
        }}
        placeholder="Ragnatela IoT Solutions"
      />

      <Campo
        rotulo="Identificador" dica="usado na URL e na confirmação de exclusão" erro={erros.slug}
        valor={v.slug}
        aoMudar={(novo) => { if (aoTocarSlug) aoTocarSlug(); mudar('slug')(novo.toLowerCase()); }}
        placeholder="ragnatela-iot"
        autoCapitalize="none" spellCheck={false}
      />
      {!erros.slug ? (
        <div style={{ marginTop: -6, marginBottom: 12, fontSize: '0.72rem', color: T.mut }}>
          {EXPLICACAO_DO_SLUG} Ele <b>não muda depois</b> — é por ele que a exclusão é confirmada.
        </div>
      ) : null}

      <div style={grade(220)}>
        <Campo
          rotulo="Nome do contato" dica="quem administra a conta" erro={erros.contatoNome}
          valor={v.contatoNome} aoMudar={mudar('contatoNome')} placeholder="Maria Souza"
        />
        <Campo
          rotulo="E-mail do contato" dica="vira o admin na plataforma" erro={erros.contatoEmail}
          tipo="email" valor={v.contatoEmail} aoMudar={mudar('contatoEmail')}
          placeholder="maria@empresa.com.br" autoCapitalize="none" spellCheck={false}
        />
      </div>
      {!erros.contatoEmail ? (
        <div style={{ marginTop: -6, marginBottom: 12, fontSize: '0.72rem', color: T.mut }}>
          E-mail repetido entre empresas é recusado pelo servidor, de propósito: a mesma pessoa com
          dois contextos é o caminho mais curto para vazar dado entre empresas.
        </div>
      ) : null}

      <div style={grade(220)}>
        <Campo
          rotulo="CNPJ" dica="opcional" erro={erros.cnpj}
          valor={v.cnpj} aoMudar={mudar('cnpj')} placeholder="00.000.000/0000-00" inputMode="numeric"
        />
        <Campo
          rotulo="WhatsApp do contato" dica="opcional, com DDD" erro={erros.contatoWhatsapp}
          valor={v.contatoWhatsapp} aoMudar={mudar('contatoWhatsapp')} placeholder="98 98335-1000" inputMode="tel"
        />
      </div>

      <Selecao
        rotulo="Plano" dica="define quantos atendentes e quantas conexões cabem" erro={erros.plano}
        valor={v.plano} vazio={planos.length ? '' : '— o servidor ainda não devolveu o catálogo —'}
        aoMudar={mudar('plano')}
        opcoes={planos.map((p) => ({
          valor: p.chave,
          rotulo: `${p.rotulo || p.chave} — ${p.agentes} atendente(s), ${p.caixas} conexão(ões)`,
        }))}
      />

      <Faixa tom="info" titulo="O que este botão faz de verdade">
        Cria a conta da empresa na plataforma, cria o administrador dela, vincula os dois e grava o
        contrato aqui. Se falhar no meio, o servidor <b>desfaz</b> o que criou — não fica conta órfã.
        A senha inicial do administrador é descartável e <b>nunca</b> é gravada por nós.
      </Faixa>
    </div>
  );
}

/**
 * A MODAL DE CADASTRO. Ela não fala com a rede: recebe `aoEnviar` de quem a abriu.
 *
 * ⚠️ A validação roda AQUI ao enviar, e roda DE NOVO dentro de `criarEmpresa` (que é quem recusa
 * antes da rede). Duas conferências da mesma regra não é desperdício neste caso: a de cá pinta o
 * campo errado, a de lá garante que nenhum outro caminho de chamada escape da regra.
 */
export function ModalDeNovaEmpresa({ aberta, planos = [], enviando, erro, ajuda, aoFechar, aoEnviar }) {
  const [valores, setValores] = useState(CADASTRO_VAZIO);
  const [erros, setErros] = useState({});
  const [slugTocado, setSlugTocado] = useState(false);

  // Limpa a cada abertura. Sem isto, cancelar um cadastro e abrir de novo traria o e-mail da
  // empresa anterior — e e-mail repetido é falha dura do lado do servidor.
  useEffect(() => {
    if (!aberta) return;
    setValores({ ...CADASTRO_VAZIO, plano: planos[0]?.chave || 'essencial' });
    setErros({});
    setSlugTocado(false);
  }, [aberta, planos]);

  const enviar = () => {
    const v = validarCadastro(valores);
    setErros(v.erros);
    if (!v.ok) return;          // ⛔ não chama a rede: o teste mede exatamente isto
    aoEnviar(valores);
  };

  return (
    <Modal
      aberta={aberta} titulo="Cadastrar empresa" aoFechar={aoFechar} largura={620}
      rodape={
        <>
          <button className="btn btn-secondary" onClick={() => aoFechar()}>Cancelar</button>
          <button className="btn btn-primary" disabled={enviando} aria-busy={enviando ? 'true' : undefined} onClick={() => enviar()}>
            {enviando ? 'Cadastrando…' : 'Cadastrar empresa'}
          </button>
        </>
      }
    >
      {erro ? <div style={{ marginBottom: 12 }}><ErroDoServidor erro={erro} ajuda={ajuda} /></div> : null}
      <FormularioDeEmpresa
        valores={valores}
        aoMudar={setValores}
        erros={erros}
        planos={planos}
        slugTocado={slugTocado}
        aoTocarSlug={() => setSlugTocado(true)}
      />
    </Modal>
  );
}
