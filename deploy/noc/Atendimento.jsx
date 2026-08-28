// ATENDIMENTO (Ragnabot) — ordem do dono, 28/08/2026:
// "quero que integre tudo, a autenticação do NOC deve ser idêntica à do chatbot"
// "só os super users do NOC gerenciam o SaaS do Ragnabot"
//
// Esta tela é a PONTE: quem já se autenticou no NOC — inclusive com o 2FA de lá —
// clica em Abrir e cai dentro do Ragnabot JÁ LOGADO, sem segunda senha e sem
// segundo código.
//
// ⚠️ Por que assim e não copiando o segredo de 2FA entre os sistemas: um segredo
//    repetido em dois lugares dobra a chance de vazar e desincroniza quando um dos
//    lados troca. Aqui o Ragnabot CONFIA em quem o NOC já autenticou — o segundo
//    fator continua sendo um só, o do NOC.
import { useState, useEffect, useCallback } from 'react';
import { Headphones, ExternalLink, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import CapaSecao from '../components/CapaSecao.jsx';
import { useToast } from '../App.jsx';

const ENDERECO = 'https://bot.ragnatela.com.br';

const cartao = {
  background: 'var(--card, #1a2332)',
  border: '1px solid var(--border, #2a3441)',
  borderRadius: 12,
  padding: 20,
};

export default function Atendimento() {
  const toast = useToast();
  const [estado, setEstado] = useState(null);      // { disponivel, url, motivo }
  const [carregando, setCarregando] = useState(true);
  const [entrando, setEntrando] = useState(false);

  const verificar = useCallback(async () => {
    setCarregando(true);
    try {
      setEstado(await api.getRagnabotStatus());
    } catch (e) {
      setEstado({ disponivel: false, url: ENDERECO, motivo: e.message });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { verificar(); }, [verificar]);

  // A janela é aberta ANTES da chamada e só depois recebe o endereço: se fosse
  // aberta no retorno da promessa, o navegador trataria como abertura automática
  // e bloquearia — o usuário veria "nada acontece" ao clicar.
  const abrir = async () => {
    const janela = window.open('', '_blank');
    setEntrando(true);
    try {
      const r = await api.entrarNoRagnabot();
      if (!r?.url) throw new Error('A plataforma não devolveu o endereço de entrada.');
      if (janela) janela.location.href = r.url;
      else window.location.href = r.url;          // bloqueador de janela: vai na mesma aba
    } catch (e) {
      if (janela) janela.close();
      toast?.(`Não consegui abrir o Ragnabot: ${e.message}`, 'error');
    } finally {
      setEntrando(false);
    }
  };

  const indisponivel = !carregando && estado && !estado.disponivel;

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <CapaSecao
        titulo="Atendimento"
        subtitulo="Plataforma de atendimento omnichannel da Ragnatela"
        icone={Headphones}
      />

      <div style={{ ...cartao, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            width: 46, height: 46, borderRadius: 12, flex: 'none',
            background: 'linear-gradient(135deg,#2ee879,#0e7a3c)',
            display: 'grid', placeItems: 'center',
          }}>
            <Headphones size={24} color="#03151f" />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Ragnabot</div>
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              WhatsApp, Instagram, Messenger, Telegram, e-mail e chat do site — em um lugar só.
            </div>
          </div>
          <button
            onClick={abrir}
            disabled={entrando || carregando || indisponivel}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '11px 20px', borderRadius: 10, border: 'none',
              background: (entrando || carregando || indisponivel) ? '#3a4553' : '#16a34a',
              color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: (entrando || carregando || indisponivel) ? 'not-allowed' : 'pointer',
            }}
          >
            {entrando ? <RefreshCw size={16} className="spin" /> : <ExternalLink size={16} />}
            {entrando ? 'Abrindo…' : 'Abrir o Ragnabot'}
          </button>
        </div>

        <div style={{
          marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border, #2a3441)',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: 0.85,
        }}>
          <ShieldCheck size={16} color="#22c55e" />
          Você entra com a sua conta do NOC — sem outra senha e sem outro código de verificação.
        </div>
      </div>

      {carregando && (
        <div style={{ ...cartao, marginTop: 12, fontSize: 13, opacity: 0.7 }}>
          Verificando a ligação com a plataforma…
        </div>
      )}

      {indisponivel && (
        <div style={{
          ...cartao, marginTop: 12,
          borderColor: '#b45309', background: 'rgba(180,83,9,.10)',
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} color="#f59e0b" style={{ flex: 'none', marginTop: 2 }} />
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              <b>A ligação com a plataforma não está respondendo.</b>
              <div style={{ opacity: 0.85, marginTop: 4 }}>{estado?.motivo || 'Motivo não informado.'}</div>
              <div style={{ opacity: 0.7, marginTop: 8 }}>
                Você ainda pode entrar direto por{' '}
                <a href={ENDERECO} target="_blank" rel="noreferrer" style={{ color: '#4ade80' }}>
                  bot.ragnatela.com.br
                </a>{' '}
                usando o seu e-mail e senha da plataforma.
              </div>
              <button
                onClick={verificar}
                style={{
                  marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 8, fontSize: 13,
                  border: '1px solid var(--border, #2a3441)', background: 'transparent',
                  color: 'inherit', cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Verificar de novo
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...cartao, marginTop: 12, fontSize: 13, lineHeight: 1.7, opacity: 0.85 }}>
        <b style={{ opacity: 1 }}>Quem tem acesso</b>
        <div style={{ marginTop: 6 }}>
          Só <b>super usuários</b> do NOC abrem a plataforma por aqui — são eles que administram as
          empresas atendidas. Cada empresa cliente enxerga apenas as próprias conversas, contatos e
          relatórios.
        </div>
      </div>
    </div>
  );
}
