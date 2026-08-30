// Ponte de compatibilidade: as rotas foram copiadas do NOC sem alteração e importam daqui.
// A decisão de identidade vive em `src/base/auth.js` (doc 33 §7) — este arquivo só reexporta,
// para que a cópia dos routers continue fiel e o dia da limpeza seja um `sed` de um caminho.
export { authMiddleware, adminOnly, superuserOnly } from '../base/auth.js';
export { default } from '../base/auth.js';
