// ════════════════════════════════════════════════════════════════════════════════════════════════
// VERSÃO DO PRODUTO — lida do arquivo `VERSAO` na raiz do repositório.
//
// Por que não sai do package.json: o produto usa `A.BB.CC` (hoje 1.03.00) e o npm exige semver sem
// zero à esquerda, então o `package.json` carrega `1.3.0`. A versão que o dono e o `VERSOES.md`
// conhecem é a do arquivo `VERSAO`, e é ela que tem de aparecer na tela e no /saude.
//
// No contêiner o `VERSAO` é copiado para junto da aplicação (ver Dockerfile). Se sumir, o valor
// do package.json serve de rede — mas com aviso, porque versão errada em incidente custa caro.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url)); // .../app/src/base

function ler() {
  // Ordem: raiz do repo (dev) → raiz da app (contêiner) → package.json (rede de segurança).
  for (const caminho of [
    join(aqui, '..', '..', '..', 'VERSAO'),
    join(aqui, '..', '..', 'VERSAO'),
  ]) {
    try {
      const v = readFileSync(caminho, 'utf8').trim();
      if (v) return v;
    } catch { /* tenta o próximo */ }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(aqui, '..', '..', 'package.json'), 'utf8'));
    // eslint-disable-next-line no-console
    console.warn('[base/versao] arquivo VERSAO não encontrado; usando a do package.json');
    return pkg.version;
  } catch {
    return 'desconhecida';
  }
}

export const VERSAO = ler();
export default VERSAO;
