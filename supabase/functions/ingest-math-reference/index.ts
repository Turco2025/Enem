/* ingest-math-reference — DESLIGADA em 13/10/2026 (verificação de segurança).
   Estava aberta, sem login: qualquer pessoa podia gravar trechos na base de
   referência do revisor de Matemática (math_reference_chunks) e gastar OpenAI.
   A base em si (1.391 trechos, carregados em 04/09/2026) continua intacta e em
   uso pela review-math-question; só a porta de entrada foi fechada.
   O código que estava no ar (versão 9) ficou guardado em original_v9.ts. Para
   uma carga nova, religar com a mesma trava "só o servidor chama" da
   review-math-question. */
Deno.serve(() => new Response(JSON.stringify({ erro: "função desativada" }), { status: 410, headers: { "content-type": "application/json" } }));
