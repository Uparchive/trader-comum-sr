# Migração operacional: Deriv Demo → OKX Demo

Data de início: 2026-09-03

## Limite científico

O histórico, hipóteses, evidências e ledger da Deriv foram preservados sem reescrita. Resultados do R_100 pertencem ao contexto experimental `DERIV_R100`; não são evidência, validação nem mandato para instrumentos OKX.

A camada ativa inicia no contexto `OKX_DEMO_2026_09_03`. Enquanto não existir uma hipótese e um mandato próprios para esse novo contexto, o executor reporta `NO_VALID_SIGNAL` e não transforma a antiga estratégia CALL/PUT em uma estratégia de cripto.

## Barreira Demo

O provider aceita apenas:

- REST `https://openapi.okx.com`;
- WebSocket Demo `wss://wspap.okx.com:8443/ws/v5/public` e `/private`;
- cabeçalho privado obrigatório `x-simulated-trading: 1`;
- credenciais `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`.

Ausência de credencial, endpoint diferente, cabeçalho ausente, resposta não OKX ou dado stale causam `TECHNICAL_FAIL_CLOSED`. Não há fallback para URLs Live.

## Operação e validação

Cada ciclo descobre instrumentos SPOT elegíveis pela API, consulta ticker, regras de tamanho/precisão e saldo Demo assinado, e valida login no WebSocket privado. O estado persistente separa `NO_VALID_SIGNAL` de falha técnica e registra métricas de REST, WebSocket, rate limit e reconexões.

Uma ordem de validação Demo existe somente atrás do opt-in explícito `OKX_DEMO_TEST_ORDER_ENABLED=true`. Isso evita uma primeira ordem automática simplesmente por publicar código. Ela usa um ID idempotente e a menor quantidade elegível retornada pelo instrumento. Após a validação e reconciliação em produção, esse opt-in deve voltar a ausente.

## Limitação antes da ativação

O commit não é evidência de autenticação nem de ordem executada. A conclusão exige deploy do Worker com os três Secrets, execução observada do cron e validação segura no endpoint publicado.
