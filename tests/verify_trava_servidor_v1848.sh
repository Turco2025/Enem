#!/usr/bin/env bash
# v18.48 — VERIFICAÇÃO DE SEGURANÇA (13/10/2026): "só o servidor chama".
#
# Sobe, de verdade, a review-math-question, a classificar-textos-enem e a
# ingest-math-reference no Deno local (chaves falsas, nenhuma IA chamada) e prova:
#   R. revisor: sem chave, com a chave pública, com token de usuário e com uma chave
#      quase igual → 401; com a chave de serviço → passa da trava e responde como
#      antes (400 sem questão, 405 em GET, e uma questão sem resíduo de notação volta
#      intacta, sem chamar IA nenhuma);
#   C. classificador: o mesmo, e com a chave de serviço chega à validação de sempre;
#   I. ingest: desligada (410) para qualquer chamada;
#   G. o gerador (generate-question) manda exatamente "Bearer <chave de serviço>".
#
# Uso: bash tests/verify_trava_servidor_v1848.sh   (precisa de deno e rede para jsr/npm/GitHub)
set -u
cd "$(dirname "$0")/.."
CONF=${DENO_CONF:-/home/claude/denotest/deno.json}
PORTA=8000
URL="http://127.0.0.1:$PORTA"
CHAVE_SERVICO="chave-de-servico-falsa-0123456789abcdefghijklmnop"
QUASE="${CHAVE_SERVICO%?}X"
PUBLICA="sb_publishable_chavePublicaFalsa0123456789"
USUARIO="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.assinaturaFalsa"
total=0; falhas=0; PID=""
ok(){ if [ "$1" = "1" ]; then total=$((total+1)); echo "PASS $2"; else falhas=$((falhas+1)); echo "FAIL $2"; [ -n "${3:-}" ] && echo "     $3"; fi; }
sobe(){
  SUPABASE_URL="http://127.0.0.1:9" SUPABASE_SERVICE_ROLE_KEY="$CHAVE_SERVICO" OPENAI_API_KEY="" ANTHROPIC_API_KEY="" \
    deno run --quiet --config "$CONF" --allow-net --allow-env --allow-read "$1" >/tmp/trava_srv.log 2>&1 &
  PID=$!
  for _ in $(seq 1 120); do curl -s -o /dev/null "$URL" 2>/dev/null && return 0; sleep 0.5; done
  echo "não subiu: $1"; cat /tmp/trava_srv.log; return 1
}
desce(){ [ -n "$PID" ] && kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; PID=""; sleep 0.3; }
pede(){ # metodo auth corpo → "status corpo"
  local m=$1 a=$2 c=${3:-}
  if [ -n "$a" ]; then curl -s -X "$m" -H "content-type: application/json" -H "authorization: Bearer $a" ${c:+-d "$c"} -w ' %{http_code}' "$URL"
  else curl -s -X "$m" -H "content-type: application/json" ${c:+-d "$c"} -w ' %{http_code}' "$URL"; fi
}
st(){ echo "$1" | awk '{print $NF}'; }

# ---------- R. revisor ----------
sobe supabase/functions/review-math-question/index.ts || exit 1
r=$(pede POST "" '{}');                    ok $([ "$(st "$r")" = 401 ] && echo 1) "R1 sem chave → 401" "$r"
r=$(pede POST "$PUBLICA" '{}');            ok $([ "$(st "$r")" = 401 ] && echo 1) "R2 chave pública do app → 401" "$r"
r=$(pede POST "$USUARIO" '{}');            ok $([ "$(st "$r")" = 401 ] && echo 1) "R3 token de professor logado → 401" "$r"
r=$(pede POST "$QUASE" '{}');              ok $([ "$(st "$r")" = 401 ] && echo 1) "R4 chave quase igual (último caractere) → 401" "$r"
r=$(pede POST "x$CHAVE_SERVICO" '{}');     ok $([ "$(st "$r")" = 401 ] && echo 1) "R5 chave com um caractere a mais → 401" "$r"
r=$(pede GET "" '');                       ok $([ "$(st "$r")" = 401 ] && echo 1) "R6 GET sem chave → 401 (nem diz que existe POST)" "$r"
r=$(curl -s -X OPTIONS -w ' %{http_code}' "$URL"); ok $([ "$(st "$r")" = 200 ] && echo 1) "R7 OPTIONS (pré-voo do navegador) continua 200" "$r"
r=$(pede POST "$CHAVE_SERVICO" '{}');      ok $([ "$(st "$r")" = 400 ] && echo "$r" | grep -q "Campo 'question'" && echo 1) "R8 chave de serviço: passa da trava e cai na validação de sempre (400 sem questão)" "$r"
r=$(pede GET "$CHAVE_SERVICO" '');         ok $([ "$(st "$r")" = 405 ] && echo 1) "R9 chave de serviço + GET → 405, como antes" "$r"
Q='{"area":"humanas","disciplina":"História","soNotacao":true,"prazoMs":20000,"question":{"area":"humanas","disciplina":"História","textoBase":"Em 1943, a Consolidação das Leis do Trabalho reuniu a legislação trabalhista.","comando":"A medida descrita relaciona-se à","alternativas":{"A":"ampliação de direitos.","B":"abertura comercial.","C":"redução do Estado.","D":"extinção de sindicatos.","E":"expansão do voto."},"resolucaoComentada":"Resolução.","gabarito":"A"}}'
r=$(pede POST "$CHAVE_SERVICO" "$Q")
ok $([ "$(st "$r")" = 200 ] && echo "$r" | grep -q "Consolidação das Leis do Trabalho" && echo 1) "R10 chave de serviço + questão sem resíduo: 200 e a questão volta intacta (os módulos fixados no commit 8328e33c carregam e funcionam)" "${r:0:300}"
grep -q "Anthropic\|OpenAI\|embedding" /tmp/trava_srv.log && ok 0 "R11 nenhuma IA chamada no teste" "$(head -c 300 /tmp/trava_srv.log)" || ok 1 "R11 nenhuma IA chamada no teste"
desce

# ---------- C. classificador ----------
sobe supabase/functions/classificar-textos-enem/index.ts || exit 1
r=$(pede POST "" '{"acao":"status"}');                 ok $([ "$(st "$r")" = 401 ] && echo 1) "C1 sem chave → 401" "$r"
r=$(pede POST "$PUBLICA" '{"acao":"carregar","url":"http://exemplo.invalido/x"}'); ok $([ "$(st "$r")" = 401 ] && echo 1) "C2 chave pública tentando 'carregar' endereço qualquer → 401" "$r"
r=$(pede POST "$USUARIO" '{"acao":"classificar"}');    ok $([ "$(st "$r")" = 401 ] && echo 1) "C3 token de professor logado → 401" "$r"
r=$(pede POST "$QUASE" '{"acao":"status"}');           ok $([ "$(st "$r")" = 401 ] && echo 1) "C4 chave quase igual → 401" "$r"
r=$(pede POST "$CHAVE_SERVICO" '{"acao":"xyz"}');      ok $([ "$(st "$r")" = 400 ] && echo "$r" | grep -q "acao inválida" && echo 1) "C5 chave de serviço: passa da trava e cai na validação de sempre" "$r"
r=$(pede GET "$CHAVE_SERVICO" '');                     ok $([ "$(st "$r")" = 405 ] && echo 1) "C6 chave de serviço + GET → 405, como antes" "$r"
desce

# ---------- I. ingest ----------
sobe supabase/functions/ingest-math-reference/index.ts || exit 1
r=$(pede POST "" '{"chunks":[{"conteudo":"x","livro":"l","arquivo":"a"}]}'); ok $([ "$(st "$r")" = 410 ] && echo 1) "I1 ingest sem chave → 410 (desligada)" "$r"
r=$(pede POST "$CHAVE_SERVICO" '{}');                                         ok $([ "$(st "$r")" = 410 ] && echo 1) "I2 ingest até com a chave de serviço → 410" "$r"
desce

# ---------- G. o gerador manda a chave certa ----------
n=$(grep -c 'functions/v1/review-math-question' supabase/functions/generate-question/index.ts)
grep -A4 'functions/v1/review-math-question' supabase/functions/generate-question/index.ts | grep -q '"authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`'
ok $([ $? -eq 0 ] && [ "$n" = 1 ] && echo 1) "G1 a generate-question chama o revisor num único ponto, com Bearer + SUPABASE_SERVICE_ROLE_KEY"
grep -rn --include=*.js --include=*.html --include=*.mjs -E "functions/v1/(review-math-question|classificar-textos-enem|ingest-math-reference)" src robo pagina index.html >/dev/null 2>&1 \
  && ok 0 "G2 nem o app, nem o robô, nem as páginas chamam essas funções" || ok 1 "G2 nem o app, nem o robô, nem as páginas chamam essas funções"

echo; echo "$total verificações passaram, $falhas falharam."
[ "$falhas" = 0 ]
