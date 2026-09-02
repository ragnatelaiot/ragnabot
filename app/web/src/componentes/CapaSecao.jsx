import { useEffect, useRef, useState } from 'react';
import { caminhoDoApp } from '../lib/prefixo.js';

/* ═══════════════════════════════════════════════════════════════════════════
   CAPA DE SEÇÃO — 98-PROPOSTA-FRONT-NOC.md §0.2
   ═══════════════════════════════════════════════════════════════════════════
   O dono aprovou a direção e reprovou o acabamento: "ainda tô achando com muita
   cara que foi feita por inteligência artificial. Poderia trabalhar capas em
   cada menu com imagens reais."

   ⚠️ A CAPA SUBSTITUI A BARRA DE TÍTULO — ela NÃO é acrescentada acima dela.
   Era a objeção do próprio dono: numa ferramenta de oito horas, foto que empurra
   conteúdo para baixo da dobra é foto que atrapalha. Por isso:
     · faixa de 130px (112 no tablet, 96 no celular), não meia tela como no login;
     · a partir de 40px de rolagem ela ENCOLHE para 56px e a foto sai — a
       orientação (título e ações) fica, que é o que serve durante o trabalho;
     · o véu tem força MEDIDA, não escolhida no olho: sobe do lado esquerdo, que
       é onde o texto assenta, até o contraste passar de 4,5:1.

   As fotos são do nosso acervo, com o pior bloco medido:
     operação 7,26:1 · infraestrutura 4,83:1 · clientes 4,68:1
     segurança 10,06:1 · administração 4,56:1

   ── ONDA 2 (as telas de DENTRO) ───────────────────────────────────────────
   Retorno do dono depois da onda 1: "ainda sinto falta de capas dentro dos
   grupos, ambientes etc, mas já melhorou muito". A capa tinha ficado só no
   primeiro nível — e o que ele mais olha é o de dentro.

   ⚠️ A FOTO TEM DE DIZER DE QUE TELA SE TRATA. Repetir a mesma capa em painel
   do grupo, ambiente, cluster, armazenamento e hardware seria papel de parede:
   quatro assuntos diferentes com a mesma cara não distinguem nada de relance.
   Por isso entraram QUATRO fotos novas, e só quatro — cada uma sustentando um
   assunto que já não cabia nas cinco antigas:
     ambiente      patch panel + switch com os cabos organizados ....  5,10:1
     cluster       três servidores idênticos, LEDs verdes, cabo duplo 11,64:1
     armazenamento gaveta de discos puxada, uma baia vazia .........   5,33:1
     hardware      servidor aberto na bancada: ventoinhas, RAM .....   4,77:1

   ⛔ O que eu NÃO fiz: uma foto por tela. Alertas do grupo reusa `operacao`,
   equipamentos reusa `infraestrutura`, o painel do grupo reusa `clientes` e a
   auditoria reusa `administracao` — mesma foto porque é o MESMO assunto. Foto
   nova sem assunto novo é só peso a mais numa tela que já carrega mapa de
   topologia e gráfico.

   ── ONDA 3 (TODO menu, e não só os principais) ────────────────────────────
   Ordem do dono: "coloque capa em cada menu do ia.ragnatela, mantenha o mesmo
   padrão nele todo". A capa passou a existir nos 28 destinos que ainda não a
   tinham — Chat IA, Relatórios, SLA, Grupos, Acessos de clientes, Segurança do
   proxy, MikroTik, ZTNA, Marketing, UniFi/Omada (config e console), Proxies
   Zabbix, Usuários, Configurações, Saldo das IAs, as três Auditorias, IPs
   penalizados, Testes, Backup, Ajuda, Versões, Documentação, Perfil e o Painel
   do bucket.

   ⚠️ "MESMO PADRÃO" é a exigência CENTRAL, e ela é do componente, não da
   página: quem usa `CapaSecao` herda altura, tipografia, posição do título, o
   encolhimento aos 40px e a sangria. Nenhuma tela redefine nada disso — capa
   diferente num menu estragaria mais do que menu sem capa.

   TRÊS fotos novas nesta onda, e só três — cada uma para um assunto que não
   cabia em nenhuma das nove:
     conhecimento  manual técnico aberto, fichários de procedimento ...  4,93:1
     auditoria     gaveta de arquivo aberta, pastas etiquetadas ......   4,52:1
     sem-fio       access point no teto, cabo penteado em calha ......   9,52:1

   ⚠️ O forno da onda 3 ganhou um SEGUNDO PORTÃO, e ele nasceu de um defeito
   real: as três fotos são CLARAS (papel branco, janela, forro de corredor) e o
   portão de contraste sozinho as aprovou com luminância média de 0,14 e 0,19,
   contra 0,04 a 0,11 das onze já no ar. O texto passava, mas a capa nascia
   visivelmente mais clara que todas as outras — quebrando justamente "o mesmo
   padrão nele todo". O portão de família (média ≤ 0,105) força o véu a subir
   dos DOIS lados. Ver `_gerador-das-capas-onda3.py`.
   ═══════════════════════════════════════════════════════════════════════════ */

const FOTO = {
  operacao:       '/capas/capa-operacao.jpg',
  infraestrutura: '/capas/capa-infraestrutura.jpg',
  clientes:       '/capas/capa-clientes.jpg',
  seguranca:      '/capas/capa-seguranca.jpg',
  administracao:  '/capas/capa-administracao.jpg',
  // onda 2 — telas internas
  ambiente:       '/capas/capa-ambiente.jpg',
  cluster:        '/capas/capa-cluster.jpg',
  armazenamento:  '/capas/capa-armazenamento.jpg',
  hardware:       '/capas/capa-hardware.jpg',
  // onda 3 — os menus que ainda estavam sem capa
  conhecimento:   '/capas/capa-conhecimento.jpg',
  auditoria:      '/capas/capa-auditoria.jpg',
  'sem-fio':      '/capas/capa-sem-fio.jpg',
};

export default function CapaSecao({ secao = 'operacao', olho, titulo, apoio, acoes = null }) {
  const [compacta, setCompacta] = useState(false);
  const pendente = useRef(false);

  useEffect(() => {
    // Rolagem é o evento mais barulhento do navegador: uma leitura por quadro,
    // via rAF, e o estado só muda quando cruza o limite — não a cada pixel.
    //
    // ⛔ HISTERESE (26/08/2026) — a capa OSCILAVA ao rolar, e a causa é realimentação:
    // havia UM limiar (40 px). Ao cruzar, a capa encolhe; encolhendo, o conteúdo sobe e a posição
    // de rolagem CAI abaixo do limiar; abaixo dele a capa expande, o conteúdo desce, e cruza o
    // limiar de novo. A própria mudança de altura desfazia a condição que a causou — pisca-pisca
    // enquanto o dedo estiver na roda do mouse.
    //
    // Com dois limiares e uma zona morta entre eles, o encolhimento (que move a rolagem em algumas
    // dezenas de pixels) não alcança mais o limiar de volta. É o mesmo remédio de um termostato:
    // liga a 18°, desliga a 22°, e não fica batendo em 20°.
    // A ZONA MORTA TEM DE SER MAIOR QUE O ENCOLHIMENTO — senão o remédio não cura.
    // Medido no CSS: a capa vai de 130 px para 56 px no desktop = 74 px a menos (tablet 112→56 = 56;
    // celular 96→56 = 40). O pior caso é 74. Com 24 e 120, a zona morta é de 96 px:
    //   • rolando para baixo: cruza 120 → encolhe → a rolagem cai 74 → fica em ~46 → 46 > 24 → NÃO expande ✅
    //   • voltando ao topo:   cruza 24  → cresce  → a rolagem sobe 74 → fica em ~98 → 98 < 120 → NÃO encolhe ✅
    const COMPACTA_ACIMA_DE = 120;  // só encolhe passando daqui
    const EXPANDE_ABAIXO_DE = 24;   // e só volta a crescer aqui — 96 px de zona morta > 74 do salto
    const aoRolar = () => {
      if (pendente.current) return;
      pendente.current = true;
      requestAnimationFrame(() => {
        pendente.current = false;
        setCompacta((antes) => {
          const y = window.scrollY;
          if (!antes && y > COMPACTA_ACIMA_DE) return true;
          if (antes && y < EXPANDE_ABAIXO_DE) return false;
          return antes;   // dentro da zona morta: NÃO mexe
        });
      });
    };
    window.addEventListener('scroll', aoRolar, { passive: true });
    aoRolar();
    return () => window.removeEventListener('scroll', aoRolar);
  }, []);

  // ⭐ 02/09/2026 (contrato S1): a foto passa pelo prefixo do deploy. Os caminhos do mapa `FOTO`
  // são ABSOLUTOS, e `COMO-SERVIR.md §4` já registrava a consequência: montada sob prefixo, a capa
  // nascia sem imagem (404 silencioso — a faixa aparece, a foto não). Era defeito pré-existente;
  // consertado aqui porque foi ao mexer no prefixo que ele apareceu de novo. Na raiz, nada muda.
  const foto = caminhoDoApp(FOTO[secao] || FOTO.operacao);

  return (
    <header className={compacta ? 'capa capa--compacta' : 'capa'}>
      {/* A foto é camada própria para poder sair sozinha ao encolher. Vazia de
          conteúdo e escondida do leitor de tela: é parede, não informação. */}
      <div className="capa__foto" style={{ backgroundImage: `url(${foto})` }} aria-hidden="true" />
      <div className="capa__txt">
        {olho && <div className="capa__olho">{olho}</div>}
        <h1 className="capa__titulo">{titulo}</h1>
        {apoio && <p className="capa__apoio">{apoio}</p>}
      </div>
      {acoes && <div className="capa__acoes">{acoes}</div>}
    </header>
  );
}
