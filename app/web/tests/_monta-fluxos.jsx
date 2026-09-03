// Entrada de MONTAGEM da tela de fluxos, só para o teste de interação (`ligacao.smoke.mjs`).
// Não entra no pacote de produção: o Vite só a empacota quando o teste pede, em modo SSR.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FluxosRagnabot from '../src/paginas/FluxosRagnabot.jsx';

export { React, act, createRoot, FluxosRagnabot };
export function elemento() { return React.createElement(FluxosRagnabot); }
