# Convenção temporal da interface V4

## Ciclo de pesquisa

A interface calcula o ciclo de pesquisa a partir de `state/current.json` → `v4_started_at`, que é a fonte canônica do início da V4.

- O calendário utilizado é `America/Sao_Paulo`.
- A data canônica de início é o **Dia 1** do Ciclo 1.
- Cada ciclo tem 90 dias corridos de calendário.
- O **Dia 90** é a data de revisão programada.
- No dia seguinte, começa automaticamente o Dia 1 do próximo ciclo.
- A troca de ciclo não altera executor, estratégia, mandato, ledger, evidências ou memória científica.

Formalmente, para `d = dias corridos desde a data de início` (com `d = 0` no primeiro dia):

- `ciclo = floor(d / 90) + 1`
- `dia do ciclo = (d mod 90) + 1`

## Manutenção Deriv

A data do Dia 90 também é exibida como **revisão preventiva da credencial Deriv**. É um lembrete administrativo: a interface não presume expiração da credencial, não lê segredos e não executa rotação automática.

Os avisos aparecem quando faltam 7, 3 e 1 dias; na data de revisão, a interface pede apenas a verificação e eventual rotação segura fora do navegador.
