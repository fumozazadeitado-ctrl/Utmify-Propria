# Painel de Rastreamento de Facebook Ads

Seu próprio painel de rastreamento, no estilo UTMify, com **o seu nome e as suas cores**. Ele cruza o gasto do Meta Ads com as vendas das plataformas e mostra o lucro real de cada campanha, conjunto e anúncio.

O Claude monta tudo para você: personaliza, roda, coloca online e ajuda a conectar as contas.

---

## Como criar o seu (5 minutos)

1. Instale o **[Claude Code](https://claude.com/claude-code)** (app para Windows/Mac ou terminal).
2. Abra o Claude Code numa pasta vazia (ex.: crie a pasta `meu-painel` na Área de Trabalho).
3. **Copie e cole esta mensagem** no Claude (troque o link pelo deste repositório):

```
Quero criar meu painel de rastreamento de anúncios personalizado.
Baixe este repositório: https://github.com/SEU-USUARIO/painel-rastreamento
Depois leia o arquivo CLAUDE.md dele e siga o passo a passo: me faça as perguntas,
personalize com o meu nome e as minhas cores, rode no meu PC para eu ver,
e me ajude a colocar online e conectar o Meta Ads e as plataformas de venda.
```

4. Responda as perguntas do Claude (nome do painel, cor, onde vai rodar). Pronto.

> Você vai precisar do **Node.js 22 ou mais novo** (o Claude confere e te avisa). Para receber vendas de verdade, o painel precisa estar online: uma **VPS** simples (~R$ 25-40/mês) é o recomendado.

---

## O que o painel faz

- **Resumo**: faturamento líquido e bruto, gastos, ROAS, lucro, margem, ROI, CPA, ticket médio, vendas pendentes, reembolsos, chargebacks, impostos e taxas
- **Gráficos**: faturamento, gastos e lucro por dia, vendas por horário, formas de pagamento (com aprovação de Pix, cartão e boleto), funil, produtos e origens
- **Campanhas**: Contas → Campanhas → Conjuntos → Anúncios, com vendas e lucro de cada um, **liga/desliga e orçamento direto no Meta**
- **Vendas**: filtros, UTMs de cada venda e exportação em CSV
- **Webhooks** prontos para Kiwify, Hotmart, Eduzz e Perfect Pay, e genérico para Monetizze, Braip, Cakto, Ticto, Yampi, Greenn, Lastlink, PagTrust e outras
- **API de pedidos** própria (`POST /api/v1/orders`)
- **API de Conversões do Meta**: envia as compras aprovadas para o Pixel
- Sincroniza com o Meta sozinho a cada 15 minutos
- Script de UTMs para a página de vendas (repassa a origem até o checkout)

## Personalizar na mão (sem o Claude)

Tudo da marca fica no arquivo **`marca.json`**:

| Campo | Para que serve |
|---|---|
| `nome` | Nome do painel (aparece no menu, login e aba do navegador) |
| `id` | Nome técnico, só minúsculas/números/hífen (usado na VPS) |
| `slogan` | Frase curta embaixo do nome |
| `titulo_login` / `texto_login` | Textos da tela de login |
| `cor_principal` / `cor_secundaria` | Cores no formato `#RRGGBB` |
| `cadastro_aberto` | `false` = só a primeira conta pode ser criada; `true` = qualquer um cria conta |
| `porta` | Porta local (padrão 3000) |

Depois de editar, feche e abra o painel de novo.

## Rodar no PC

- **Windows**: dois cliques em `INICIAR.bat`.
- **Mac/Linux**: `npm start` e abra http://localhost:3000

Não precisa de `npm install`: o app não tem dependências. Os dados ficam na pasta `data/` (nunca suba essa pasta para o GitHub).

## Colocar online e conectar as contas

- VPS: `deploy\enviar-para-vps.ps1 -Ip IP_DA_VPS -Dominio track.seusite.com` (detalhes no `CLAUDE.md`, passo 5)
- Meta Ads, webhooks, UTMs e Pixel: [`docs/CONECTAR-CONTAS.md`](docs/CONECTAR-CONTAS.md)

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm start` | Liga o painel |
| `npm run verificar` | Confere se está tudo certo para rodar |
| `npm run senha -- email@x.com NovaSenha` | Troca uma senha esquecida |
