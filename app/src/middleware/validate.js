// Validação de corpo de requisição. Faz o que o equivalente do NOC faz, sem trazer o resto dele.
// Recebe um esquema Zod e devolve middleware; erro de forma vira 400 com a lista de campos — e
// nunca 500, que faria um erro do CLIENTE parecer defeito nosso no monitor.
export function validateBody(esquema) {
  return (req, res, next) => {
    if (!esquema?.safeParse) return next();
    const r = esquema.safeParse(req.body);
    if (r.success) { req.body = r.data; return next(); }
    return res.status(400).json({
      error: 'CORPO_INVALIDO',
      campos: r.error.issues.map((i) => ({ campo: i.path.join('.'), motivo: i.message })),
    });
  };
}
export default { validateBody };
