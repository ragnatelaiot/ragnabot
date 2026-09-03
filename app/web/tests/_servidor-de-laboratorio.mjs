// ════════════════════════════════════════════════════════════════════════════════════════════════
// SERVIDOR DE LABORATÓRIO — serve o pacote CONSTRUÍDO e finge o motor
//
// Existe para a prova em navegador (`ligacao-navegador.mjs`) medir o artefato que chega ao
// navegador, e não o arquivo-fonte: foi por medir o fonte que uma linha de CSS derrubou oito telas
// em 03/09/2026 sem nenhum teste reclamar.
//
// ⛔ SÓ LABORATÓRIO. Não sobe em imagem nenhuma, não fala com banco nenhum, não tem segredo nenhum.
//
// COMO RODAR (a partir de `app/web/`):  npm run build && node tests/_servidor-de-laboratorio.mjs
// ════════════════════════════════════════════════════════════════════════════════════════════════
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const app = express();
app.use(express.json({ limit: '5mb' }));

const doc0 = {
  nos: [
    { id: 'no_inicio', tipo: 'inicio', titulo: 'Início', config: {}, ui: { x: 40, y: 40 } },
    { id: 'no_botoes', tipo: 'botoes', titulo: 'Confirma?', config: { corpo: 'Confirma?', botoes: [{ id: 'sim', rotulo: 'sim' }, { id: 'nao', rotulo: 'não' }] }, ui: { x: 420, y: 40 } },
  ],
  arestas: [], variaveis: [],
};
let rascunho = { fluxoId: 'f1', documento: doc0, rev: 3 };
const puts = [];

app.get('/sessao/eu', (_q, r) => r.json({ autenticado: true, ator: { id: 'u1', nome: 'Dono', papel: 'super', empresaId: 'e1' }, versao: '1.11.01' }));
const B = '/api/ragnabot-fluxo';
app.get(`${B}/saude`, (_q, r) => r.json({ schema: { pronto: true }, podeAgora: { administrarFluxos: true, publicar: true }, componentes: {} }));
app.get(`${B}/catalogo`, (_q, r) => r.status(404).json({ error: 'ainda não existe' }));
app.get(`${B}/fluxos`, (_q, r) => r.json({ itens: [{ id: 'f1', nome: 'Principal', estado: 'rascunho', entrada: 'caixa', atualizadoEm: new Date().toISOString() }], total: 1 }));
app.get(`${B}/fluxos/f1`, (_q, r) => r.json({ fluxo: { id: 'f1', nome: 'Principal', estado: 'rascunho', entrada: 'caixa' }, rascunho, versaoPublicada: null, totalVersoes: 0 }));
app.get(`${B}/fluxos/f1/rascunho`, (_q, r) => r.json(rascunho));
app.put(`${B}/fluxos/f1/rascunho`, (q, r) => {
  puts.push(q.body);
  rascunho = { ...rascunho, documento: q.body.documento, rev: q.body.rev + 1 };
  r.json({ rev: rascunho.rev });
});
app.get(`${B}/fluxos/f1/telemetria`, (_q, r) => r.json({ itens: [] }));
app.get(`${B}/fluxos/f1/incidentes`, (_q, r) => r.json({ itens: [] }));
app.get(`${B}/fluxos/f1/execucoes`, (_q, r) => r.json({ itens: [] }));
app.get('/__lab/zerar', (_q, r) => { puts.length = 0; rascunho = { fluxoId: 'f1', documento: JSON.parse(JSON.stringify(doc0)), rev: 3 }; r.json({ ok: true }); });
app.get('/__lab/puts', (_q, r) => r.json({ puts, arestas: rascunho.documento.arestas }));

app.use(express.static(DIST));
app.get('*', (_q, r) => r.sendFile(path.join(DIST, 'index.html')));
app.listen(4599, '127.0.0.1', () => console.log('lab em http://127.0.0.1:4599'));
