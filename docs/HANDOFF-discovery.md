# Handoff: descoberta de vagas (Área do Dono)

Estado em 2026-11-20, ao pausar o trabalho. Leia junto com `CONTEXT.md` (glossário) e `docs/adr/`.

## O que é

Painel privado em `#/discovery`, visível só para a conta master. Coleta vagas remotas que aceitam quem mora no Brasil, filtra por regras, pontua pela Natureza do Trabalho com o Gemini e manda e-mail das melhores. Mora no Jobscope, não no portfólio: ver `docs/adr/0001-descoberta-dentro-do-jobscope.md`.

## Em produção (último deploy: `8d9399f`, CI verde)

- **Coleta agendada** às 07:00 e 13:00, de segunda a sexta, America/Sao_Paulo (EventBridge Scheduler → `DiscoveryFn`, 15 min de teto, trava no DynamoDB em `DISC#LOCK`).
- **Fontes:** Himalayas (`/jobs/api/search?country=Brazil`, chave em `HIMALAYAS_API_KEY`), Remotive, Remote OK, Rebase Jobs (token em `REBASE_API_TOKEN`), 4 Day Week e os ATS da tabela de empresas (Greenhouse, Lever, Ashby). O **We Work Remotely saiu** em `8d9399f`: ver "Decisões pendentes".
- **Pipeline** (`api/src/handlers/discovery.ts`): coleta → upsert/dedup (`store.ts`, `merge.ts`) → regras (`rules.ts`, vocabulário em `rules-config.ts`) → Gemini em lotes de 8 (`score.ts`, `judge.ts`, `gemini.ts`) → alerta SES (`alerts.ts`).
- **Gemini:** modelo próprio `gemini-3.5-flash-lite`, `thinkingLevel: low`, até 15 chamadas por coleta. A demo usa `gemini-3.6-flash` (20 req/dia no gratuito, por projeto): **nunca calibrar com o modelo da demo**.
- **Retenção (TTL ligado na tabela, atributo `ttl`):** descartada é apagada na hora e deixa só uma Impressão Digital (`DISC#GONE`, ~100 bytes, 30 dias); não decidida expira 30 dias após a publicação; promovida fica para sempre. Nenhuma etapa lê a tabela inteira: tudo passa pelo índice `gsi1` (por data de publicação).
- **Configurações** (DynamoDB `DISC#SETTINGS`, editáveis na aba settings): e-mail do alerta, alerta a partir de 80, Nota Mínima 60, 3 anos de experiência, Perfil de Aderência. O perfil não está no repo (o repo é público).
- **SES:** e-mail do alerta verificado pelo dono. Em sandbox, só envia para endereço verificado.
- **Testes:** 180 no CI (`npm test`), com fixtures reais reduzidas em `api/test/fixtures/`.

## Problema principal em aberto: qualidade das vagas ("slop")

O dono abriu as vagas do painel e a maioria parece lixo:
- **Cadeia de redirecionamento:** o link leva a um agregador, que leva a outro, que manda entrar num portal, procurar a vaga e se cadastrar. Não é a empresa contratando.
- **Vagas velhas.**
- **Ar de suspeita** em geral.

Nada disso foi investigado ainda. Pontos de partida:
- Medir **de onde vêm as vagas que passam** (fonte e domínio do link final). O Himalayas trouxe 80 das ~110 aprovadas na primeira coleta, e o `applicationLink` dele costuma apontar para a página do próprio Himalayas, não para o ATS da empresa.
- Empresas que são **revendedoras de vagas**, não empregadores: Xperteez Technology (várias "AI Trainer" e "Expert" com nota 88-90) e RemoteJobsOne apareceram no topo. Talvez seja preciso uma lista de "empresas que não contratam diretamente", no estilo de `AGENCY_COMPANIES`.
- **Link direto como critério:** priorizar ou exigir vaga com link para um ATS conhecido (greenhouse.io, lever.co, ashbyhq.com, workable, smartrecruiters...) em vez de página de agregador.
- **Idade:** a janela "hoje/24h/48h" usa a data de publicação da fonte. Conferir se a fonte republica vaga velha com data nova.
- As **fontes de ATS diretos** (Coderoad, Arena, Connectly...) não têm esse problema, mas quase nunca aparecem no painel, porque as vagas delas foram publicadas há semanas (o dono decidiu manter a janela pela data de publicação). Ampliar a lista de empresas ATS pode render mais vaga real que os agregadores.

## Decisões pendentes

1. **We Work Remotely.** Saiu das fontes porque a maioria das vagas trava o "Apply" atrás de assinatura paga. O RSS não diz quais, e a página fica atrás de um desafio anti-robô da Cloudflare (403 "Just a moment..." para o fetch do Node; o `curl` passou até ser barrado também). Não contornar o anti-robô. Depois, o dono disse que vaga premium ele mesmo descarta e que o problema seria ela tomar o lugar de outra. Ela não toma: o painel não tem limite de vagas, e o único ponto de disputa é a cota do Gemini, que no máximo atrasaria uma vaga em uma coleta. **Proposta ainda sem resposta:** trazer o WWR de volta com a marca "[wwr: pode exigir premium]" e com as vagas só do WWR por último na fila do Gemini. Reverter `8d9399f` e acrescentar a marca e a prioridade. As vagas do WWR que já estavam no banco **não foram apagadas** (elas expiram sozinhas em 30 dias).
2. **Etapa 7, o Worker de Currículo, não começou.** O desenho está fechado em `docs/adr/0002-worker-local-de-curriculo.md`:
   - worker no PC do dono, modelo pull (busca pedidos na API, sem porta aberta);
   - chat na Candidatura;
   - Claude Code da assinatura rodando dentro de `~/dev/latam-cv-maker`;
   - permissão `deny` de escrita em `base/**`, porque o perfil-mestre nunca é editado;
   - sempre um currículo novo, com a nomenclatura do LATAM CV Maker.

## Fontes candidatas (estudadas em 2026-11-24)

Entraram duas fontes:
- **Rebase Jobs** (`sources/rebase.ts`): catálogo curado de vagas de dev em empresa de fora que contrata quem mora no Brasil, lido dos sites de carreira das empresas duas vezes por dia. `GET /api/v1/agent/jobs` traz o anúncio inteiro e o `apply_url` direto do ATS. Pede o token pessoal do dono (`REBASE_API_TOKEN`, segredo do GitHub → env da Lambda). Sem token a fonte devolve vazio. Limite de 60 chamadas por minuto e 50 vagas por página. O `hires_in_brazil: yes` vira a dica `country:brazil`. Também tem MCP em `https://rebasedev.com.br/mcp`, com OAuth ou o mesmo token.
- **4 Day Week** (`sources/fourdayweek.ts`): API v2 pública, sem chave, liberada no robots.txt, com `country=Brazil&work_arrangement=remote`. A API não dá mais o link de candidatura (`apply_url removed`) e a página da vaga o esconde de quem não está logado. Para o Brasil, quase nenhuma vaga é de semana de 4 dias de verdade.
- As duas olham 3 dias além do `since`: o 4 Day Week avisa que uma vaga pode levar até 48h para aparecer na API, e a Rebase data a vaga pela data do ATS.

Ficaram de fora:
| Site | Motivo |
|---|---|
| Remotar | Tem API JSON aberta (`api.remotar.com.br/jobs`) com link direto do ATS, mas os termos de uso proíbem cópia por robô/crawler. Só entra com autorização escrita deles. |
| Jobgether | A API é pública, mas o `url` é a página do próprio Jobgether (intermediário), a página dá 403 para robô e a listagem vem sem o texto do anúncio. |
| Wellfound | Não tem API, e o robots.txt bloqueia a busca. |
| EuropeRemotely | O robots.txt dá `Disallow: /` para todos, e a página responde 403. |
| Just Remote | Só tem HTML, e as vagas "escondidas" ficam atrás de pagamento. |
| Flexa | Não tem API, e as vagas são do Reino Unido. |
| Otta | Virou o Welcome to the Jungle. Não tem API. |
| Cord | Virou um agente de busca que exige conta. |

## Empresas bloqueadas

`BLOCKED_COMPANIES` em `rules-config.ts` (hoje só a `micro1`, a pedido do dono em 2026-11-24). Diferente de `AGENCY_COMPANIES`, que só marca a vaga, a empresa bloqueada tem a vaga descartada antes de qualquer outro filtro. Além disso, a cada coleta `purgeBlocked` apaga as vagas já guardadas nos últimos 30 dias, menos as promovidas.

## Como operar

- **Rodar uma coleta agora:** botão "run now" na aba runs, ou `aws lambda invoke --function-name JobscopeStack-DiscoveryFnEFFCFFEF-MvuKpvcsrEjK --payload '{"trigger":"manual"}' --cli-binary-format raw-in-base64-out out.json` (us-east-1).
- **Testar as fontes sem tocar no banco:** `HIMALAYAS_API_KEY=... REBASE_API_TOKEN=... npx tsx api/scripts/collect-dry-run.ts`.
- **Gravar o perfil ou o e-mail por script:** `TABLE_NAME=... npx tsx api/scripts/put-settings.ts --profile <arquivo fora do repo>`.
- **Chaves locais:** `.env` na raiz (ignorado pelo git). `GEMINI_API_KEY` foi lida da Lambda `AnalyzeFn`.
- **Push na `main` faz deploy** (GitHub Actions + OIDC, com typecheck e testes antes).

## Armadilhas já pagas

- **Escape em scripts Python via heredoc:** `\b` e `\n` dentro de código TS viraram caracteres de controle e quebraram regex e strings. Para trechos com barra invertida, use o Edit ou um script em arquivo, nunca um heredoc.
- **O limite de concorrência da conta AWS é 10:** reserved concurrency é recusado. A trava é no DynamoDB.
- **Faixa "3-5 years"** vira "3 5 years" no texto normalizado. Já tratado e com teste.
- **O Himalayas marca "Senior" em vagas de título neutro.** O dono decidiu: sênior sai.
