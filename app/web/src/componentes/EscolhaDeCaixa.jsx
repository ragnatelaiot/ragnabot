// ════════════════════════════════════════════════════════════════════════════════════════════════
// ESCOLHER A CAIXA DE ENTRADA PELO NOME — contrato S-CLAREZA, 03/09/2026
//
// A FRASE DO DONO, diante do campo de criar fluxo: *«seria melhor que esse campo já puxasse em menu
// lista as opções com o nome para não confundir»*. Até aqui o campo era um NÚMERO digitado à mão
// (`cwInboxId`), e o número não diz nada a ninguém: «34» não é «WhatsApp Ragnatela».
//
// ── POR QUE ISTO É MAIS QUE CONFORTO ────────────────────────────────────────────────────────────
// Errar um dígito não dá erro. Grava, publica, e o fluxo simplesmente NUNCA dispara — porque o
// motor compara o número gravado com o da caixa que chegou no evento. O sintoma é «o robô não
// responde», dias depois e longe da causa. É a mesma família de defeito mudo que já custou um
// contrato inteiro (ver o cabeçalho de `paginas/CaixasDeEntrada.jsx`).
//
// ── ⛔ A LISTA É CONVENIÊNCIA; A SEGURANÇA CONTINUA NO SERVIDOR ─────────────────────────────────
// `problemaNaCaixaDoFluxo()` segue recusando, no motor, todo fluxo cuja caixa o cadastro prove não
// existir. Quem chama a API direto encontra a mesma porta trancada. Uma tela que escolhe bem nunca
// é uma guarda — é só uma tela que erra menos.
//
// ── OS QUATRO ESTADOS, e nenhum deles é uma lista vazia sem explicação ─────────────────────────
//   · carregando    → «Procurando as caixas…», e o campo desabilitado (não some: sumir dá a
//                     impressão de que a tela quebrou);
//   · com opções    → a lista, com nome e identificador;
//   · CADASTRO VAZIO→ diz o que fazer («Sincronizar agora», em Caixas de entrada) e OFERECE o campo
//                     numérico como saída — travar quem sabe o número seria trocar um obstáculo por
//                     outro;
//   · falhou        → o motivo em português + o mesmo campo numérico de antes. Uma consulta que não
//                     respondeu não pode impedir alguém de criar um fluxo.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Sem o `React` de importação padrão: o projeto usa o compilador de JSX automático, e importá-lo
// só para não usar faz o empacotador avisar em toda construção — aviso que ninguém lê é aviso
// que esconde o próximo, que importa.
import { useEffect, useState } from 'react';
import { listarCaixasDoEscopo, rotuloDaCaixa } from '../lib/api.js';
import { Rotulo, T, campoEstilo } from '../paginas/EmpresaFormulario.jsx';

/**
 * Carrega as caixas do escopo UMA vez por abertura. `ativo` diz quando buscar — a modal existe
 * montada com `aberta=false`, e buscar aí seria uma consulta por tela aberta que ninguém pediu.
 *
 * @returns {{estado:'ocioso'|'carregando'|'pronto'|'falhou', itens:Array, erro:string|null}}
 */
export function useCaixasDoEscopo(ativo, { tenantId = null } = {}) {
  const [estado, setEstado] = useState('ocioso');
  const [itens, setItens] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    setEstado('carregando');
    setErro(null);
    listarCaixasDoEscopo({ tenantId: tenantId || undefined })
      .then((r) => {
        if (!vivo) return;
        setItens(r.itens);
        setEstado('pronto');
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e?.message || 'Não consegui ler o cadastro de caixas.');
        setEstado('falhou');
      });
    // A trava contra resposta atrasada: sem ela, fechar e reabrir a modal depressa faria a resposta
    // da abertura ANTERIOR sobrescrever a lista da atual.
    return () => { vivo = false; };
  }, [ativo, tenantId]);

  return { estado, itens, erro };
}

const apoio = { fontSize: '0.75rem', color: T.mut, marginTop: 4, lineHeight: 1.45 };

/**
 * O campo. `valor` e `aoMudar` trabalham sempre com TEXTO (o que um `<select>`/`<input>` entrega);
 * quem chama converte para número na hora de enviar, como já fazia.
 *
 * @param {{rotulo?:string, dica?:string, valor:string, aoMudar:(v:string)=>void,
 *          caixas:{estado:string,itens:Array,erro:string|null}, desabilitado?:boolean}} p
 */
export function CampoDeCaixa({
  rotulo = 'Caixa de entrada',
  dica = 'de qual conexão vêm as conversas deste fluxo',
  valor, aoMudar, caixas, desabilitado = false,
}) {
  const { estado, itens, erro } = caixas;
  const temLista = estado === 'pronto' && itens.length > 0;
  // Fora da lista, mas preenchido: um fluxo antigo apontando para caixa que saiu do cadastro. A
  // opção «(fora do cadastro)» existe para o valor NÃO sumir do campo em silêncio ao abrir a tela.
  const foraDaLista = temLista && valor && !itens.some((c) => String(c.cwInboxId) === String(valor));

  if (temLista) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Rotulo dica={dica}>{rotulo}</Rotulo>
        <select
          value={valor ?? ''}
          onChange={(ev) => aoMudar(ev.target.value)}
          style={campoEstilo}
          disabled={desabilitado}
          data-campo="caixa"
        >
          <option value="">— escolha a conexão —</option>
          {itens.map((c) => (
            <option key={c.cwInboxId} value={String(c.cwInboxId)}>{rotuloDaCaixa(c)}</option>
          ))}
          {foraDaLista ? <option value={String(valor)}>{`caixa ${valor} (fora do cadastro)`}</option> : null}
        </select>
        {foraDaLista ? (
          <div style={{ ...apoio, color: T.aviso }}>
            Esta caixa não está no cadastro atual — ela pode ter sido removida da plataforma.
          </div>
        ) : null}
      </div>
    );
  }

  // ── Sem lista: o campo numérico de sempre, mas nunca calado ──────────────────────────────────
  return (
    <div style={{ marginBottom: 12 }}>
      <Rotulo dica={dica}>{rotulo}</Rotulo>
      <input
        type="number"
        value={valor ?? ''}
        onChange={(ev) => aoMudar(ev.target.value)}
        style={campoEstilo}
        disabled={desabilitado || estado === 'carregando'}
        placeholder={estado === 'carregando' ? 'Procurando as caixas…' : 'id da caixa na plataforma'}
        data-campo="caixa"
      />
      {estado === 'carregando' ? <div style={apoio}>Procurando as caixas…</div> : null}
      {estado === 'pronto' && itens.length === 0 ? (
        <div style={{ ...apoio, color: T.aviso }}>
          O cadastro de caixas está vazio. Abra <b>Caixas de entrada</b> e clique em «Sincronizar
          agora» — enquanto ele estiver vazio, não há o que escolher aqui.
        </div>
      ) : null}
      {estado === 'falhou' ? (
        <div style={{ ...apoio, color: T.aviso }}>
          Não consegui listar as caixas ({erro}). Dá para seguir informando o número — o servidor
          confere se ela existe antes de gravar.
        </div>
      ) : null}
    </div>
  );
}

export default CampoDeCaixa;
