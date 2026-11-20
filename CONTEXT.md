# Jobscope

Rastreador de candidaturas de um único dono, com uma área privada de descoberta que
coleta vagas remotas internacionais abertas a candidatos do Brasil/LATAM e as ordena
pelo quanto pagam por julgamento de engenharia.

## Language

### Descoberta

**Vaga Descoberta**:
Uma vaga coletada automaticamente de uma Fonte, ainda não transformada em Candidatura.
_Avoid_: job, posting, oportunidade

**Candidatura**:
Uma vaga que o dono decidiu acompanhar; pode nascer de uma URL colada ou de uma Vaga Descoberta.
_Avoid_: application (fora do código), vaga salva

**Fonte**:
Origem de onde uma Vaga Descoberta foi coletada (um agregador ou o ATS de uma empresa). Uma vaga pode ter várias Fontes.
_Avoid_: provider, site, feed

**Área do Dono**:
Tudo que só a conta mestre enxerga; invisível para contas demo e convidadas.
_Avoid_: admin, painel admin

### Filtros

**Balde LATAM**:
A conclusão sobre se a vaga aceita candidato morando no Brasil: confirmado, provável ou descartado.
_Avoid_: status LATAM, elegível

**Mercado Local**:
Vaga remota de empresa brasileira paga em reais. Aparece no painel com essa marca e passa pelos mesmos filtros, mas nunca dispara Alerta de Vaga. O alvo principal é a vaga internacional.
_Avoid_: vaga nacional, vaga BR

**Barreira de Experiência**:
O que a vaga exige de experiência acima do que o dono tem: anos mínimos maiores que os dele, ou qualquer nível sênior (Senior, Staff, Principal, Lead). A vaga sai do jogo por mais aderente que seja; não se aplica mentindo.
_Avoid_: senioridade, nível

**Exigência de Fuso**:
Janela de horário que a vaga pede. É só informação: o dono aceita qualquer fuso, então ela nunca descarta uma vaga. Não confundir com onde a empresa contrata, que é o que decide o Balde LATAM.
_Avoid_: timezone, overlap

**Descartada**:
Vaga Descoberta retirada da lista por um filtro (Balde LATAM ou Barreira de Experiência), guardada com o motivo para auditoria das regras.
_Avoid_: rejeitada, excluída

### Nota

**Perfil de Aderência**:
Retrato do dono derivado do Perfil-Mestre, sem dados de contato nem detalhes confidenciais de empregadores, usado só para pontuar vagas.
_Avoid_: job profile, perfil de vaga

**Natureza do Trabalho**:
O quanto a vaga remunera julgamento de engenharia (decidir onde usar IA e onde usar código determinístico, arquitetura, regra de negócio, custo) em vez de execução numa stack específica. É o critério de ordenação.
_Avoid_: match de skills, aderência técnica

**Alerta de Vaga**:
E-mail enviado ao dono quando uma coleta encontra vaga nova com Balde LATAM confirmado e Natureza do Trabalho acima do limite. Agrupa as vagas da coleta e nunca repete uma vaga já alertada; o resto fica só no painel.
_Avoid_: notificação, aviso

**Agência**:
Empresa de staff augmentation ou nearshore que contrata o dono e o aloca num cliente. Quando a vaga não descreve o trabalho no cliente, a Natureza do Trabalho fica neutra em vez de punida, e a vaga leva essa marca.
_Avoid_: body shop, consultoria, outsourcing

### Geração de currículo

**Worker de Currículo**:
Processo no computador do dono que atende Pedidos de Currículo rodando o Claude Code da assinatura dele dentro do LATAM CV Maker. A plataforma nunca o chama; ele busca trabalho.
_Avoid_: agente, bot, integração Claude

**Pedido de Currículo**:
Conversa entre o dono e o Worker de Currículo, aberta a partir de uma Candidatura, que termina em currículo e cover letter novos para aquela vaga. Nunca altera o Perfil-Mestre e nunca sobrescreve um entregável anterior.
_Avoid_: job, tarefa, geração
