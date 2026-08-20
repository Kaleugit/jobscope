# Setup da conta AWS (Free Plan, custo zero)

Guia para criar sua conta AWS com garantia de não-cobrança. Siga na ordem.

## 1. Criar a conta no Free Plan

1. Acesse [aws.amazon.com/free](https://aws.amazon.com/free) → **Create a Free Account**.
2. Use seu e-mail e crie a conta.
3. **Passo crítico:** quando perguntarem o plano, escolha **Free Plan** (não o Paid Plan).
   - Você ganha **US$ 100 em créditos** imediatamente e pode ganhar até +US$ 100 completando atividades de exploração.
   - No Free Plan a AWS **não consegue cobrar além dos créditos**: quando eles acabam ou completam 6 meses, a conta é fechada automaticamente (dados retidos por 90 dias caso queira migrar para o pago).
4. O cartão de crédito é pedido apenas para **verificação de identidade** (cobrança de ~US$ 1 estornada). No Free Plan ele não é cobrado.

## 2. Proteger a conta (faça antes de qualquer outra coisa)

1. **MFA no usuário root**: Console → IAM → "Add MFA for root user". Use um app autenticador (Google Authenticator, etc.).
2. **Nunca use o root no dia a dia.** Crie um usuário de trabalho:
   - IAM → Users → Create user → nome `kaleu-dev`
   - Marque "Provide user access to the AWS Management Console"
   - Permissões: anexe a policy `AdministratorAccess` (ok para conta pessoal de estudo)
   - Ative MFA nesse usuário também
3. **Billing alarm** (mesmo no Free Plan, para acompanhar o consumo dos créditos):
   - Console → Billing → Budgets → Create budget → template "Zero spend budget"
   - Ele avisa por e-mail se qualquer cobrança real aparecer

## 3. Configurar o CLI na sua máquina

```bash
# instalar AWS CLI v2 (Windows)
winget install Amazon.AWSCLI

# criar access key para o usuário kaleu-dev:
# Console → IAM → Users → kaleu-dev → Security credentials → Create access key
# (tipo: Command Line Interface)

aws configure
# AWS Access Key ID:     <cole aqui>
# AWS Secret Access Key: <cole aqui>
# Default region name:   us-east-1
# Default output format: json

# testar
aws sts get-caller-identity
```

## 4. Bootstrap do CDK (uma vez só)

```bash
cd infra
npx cdk bootstrap
```

Isso cria o bucket/roles que o CDK usa para fazer deploys. Depois disso, `npm run deploy` na raiz sobe o projeto inteiro.

## 5. Chave da API Gemini (grátis, para a parte de IA)

1. Acesse [aistudio.google.com/apikey](https://aistudio.google.com/apikey) com sua conta Google.
2. Crie uma API key (free tier — sem cartão).
3. Antes do deploy: `export GEMINI_API_KEY=sua-chave` (Git Bash).

## O que NUNCA fazer (para manter custo zero)

- ❌ Não suba EC2 "só pra testar" e esqueça ligada
- ❌ Não crie NAT Gateway (cobra por hora, ~US$ 32/mês)
- ❌ Não crie cluster EKS (~US$ 72/mês)
- ❌ Não migre para o Paid Plan sem antes configurar budgets com alertas
- ✅ Tudo neste projeto é serverless: sem uso = sem custo
