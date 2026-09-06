# Política de retenção V3

## Retenção científica

Evidência científica única não expira. Runs, relatórios, decisões, falhas, pré-registros, hashes, manifestos, snapshots e relações de superseding são permanentes e versionados.

Ao sair da janela operacional, o registro somente muda de temperatura. Antes disso, o processo verifica ID, integridade, índice, snapshot e manifesto/hash quando aplicável. Depois ele sai do índice HOT, mas permanece localizável por data, hipótese, experimento e run ID.

## Retenção operacional

HOT: até 90 dias. WARM: 91–180 dias. COLD: acima de 180 dias. Limites são configuráveis em `config/v3_architecture.json`. O site carrega inicialmente somente HOT.

## Limpeza permitida

Podem ter TTL: cache, temporários, downloads, builds e materializações deterministicamente regeneráveis. Duplicata só pode ser removida após verificação de conteúdo e referências.

Dados científicos brutos só podem sair do Git após existir política explícita de reprodução, manifesto com hash e localização durável. A migração para object storage deve preservar `dataset_id`, hash, commit, configuração e runs consumidores.

## Proibições

Não apagar por idade, não substituir resultados, não ocultar falhas técnicas e não usar Git como banco infinito de ticks.

