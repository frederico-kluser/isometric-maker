# Combate: alvo travado com zonas oscilantes

> **Quick Start (TL;DR)**
>
> Você clica no inimigo e escolhe atacar. A partir daí aparece uma tabela de chance por zona do corpo — cabeça, torso, braços, pernas — e **essas porcentagens oscilam ao vivo**. Você troca de zona com as teclas `1`–`4`. Cabeça acerta = morte, mitigada por elmo. Por cima disso, o ângulo relativo multiplica o dano: frente `1.0×`, flanco `1.5×`, costas `2.5×`.
>
> A oscilação é uma **função determinística do tick**, então o cliente desenha a 60 fps sem o servidor mandar nada. Isso é ótimo para banda e é exatamente por isso que é o maior risco de cheat do jogo.

## Por que este modelo, e não mira no mouse

A documentação de rede da Valve — a referência primária de servidor autoritativo — traz um aviso que decide o desenho:

> *"Multiplayer hit detection is not pixel perfect and has known precision limitations based on the tickrate and the speed of moving objects."*

Num jogo onde acerto na cabeça **mata na hora**, resolução por hitbox pixel-perfect é a pior combinação possível: a imprecisão inerente da compensação de lag viraria morte definitiva e irreversível. O jogador não perde 20% de vida por um erro de milissegundos; perde o personagem para sempre.

O modelo de alvo travado com zona declarada **contorna o problema inteiro**. Não existe hitbox geométrica para errar por alguns milissegundos, não existe vantagem de quem tem melhor conexão na hora de mirar, e não existe superfície para aimbot. A perícia migra de reflexo motor para leitura e decisão — o que também combina melhor com um jogo de posicionamento.

A mesma fonte estabelece a outra metade da regra:

> *"The client would just tell the server with a 'hit' message what player has been hit and where. We can't allow that simply because a game server can't trust the clients on such important decisions. Even if the client is 'clean' and protected by Valve Anti-Cheat, the packets could be still modified on a 3rd machine while routed to the game server."*

Um *cheat proxy* numa terceira máquina injeta mensagens de acerto sem que nada no cliente seja detectável. Portanto: **o cliente nunca decide acerto, dano ou morte.** Ele desenha a curva e envia a intenção de troca de zona. O servidor recalcula tudo.

## A oscilação

Cada zona tem uma curva de probabilidade ao longo do tempo, definida por média, amplitude e frequência:

| Zona | Média | Amplitude | Leitura |
|---|---|---|---|
| Cabeça | baixa | **alta** | janelas raras e curtas de oportunidade |
| Torso | alta | baixa | a escolha segura, quase sempre disponível |
| Braços | média | média | desarmar, reduzir dano do oponente |
| Pernas | média | média | reduzir mobilidade, impedir fuga |

Os parâmetros saem do estado do engajamento: perícia do atacante, tipo de arma, velocidade e postura do alvo, stamina dos dois, ângulo relativo e cobertura de armadura. Stamina baixa achata a curva — cansado, você erra mais e a janela da cabeça quase desaparece.

### A propriedade de rede

Se a curva é `f(engagement_id, tick, estado)` e o estado muda pouco, o servidor manda **uma vez** o seed e os parâmetros na abertura do engajamento, e o cliente desenha a 60 fps por conta própria. Depois disso só trafega mudança de estado — distância, postura, arma, stamina cruzando um limiar.

A alternativa ingênua — o servidor transmitir as quatro porcentagens 20 vezes por segundo — custaria algo como 20 × 4 valores × N engajamentos por segundo, para sempre. A versão determinística custa algumas dezenas de bytes na abertura. Num jogo com centenas de jogadores simultâneos e egress cobrado por GB, isso não é elegância: é a conta de luz.

E há um benefício que só aparece sob rede ruim: **o combate é imune a head-of-line blocking**. Se o WebSocket engasgar 300 ms, a tabela continua correta na tela, porque o cliente a está computando, não recebendo. A mecânica que mais importa é a que degrada menos.

## O risco: determinismo público é previsível

O mesmo determinismo que economiza banda permite que um bot compute a curva e aperte a tecla exatamente no pico da cabeça. Acerto perfeito, sempre. **Este é o problema central de anti-cheat do jogo, não um detalhe de implementação.**

Quatro camadas, em ordem de importância:

### 1. Commit atrasado

A rolagem usa o valor da curva no tick de **commit** — keypress + N ticks — e não no tick do keypress. Acertar o pico deixa de ser leitura do presente e passa a ser previsão do futuro. Para um humano a diferença é imperceptível (você mira a janela, não o instante); para um bot, destrói a estratégia de snipar o máximo local.

### 2. Troca de zona tem preço

Trocar de zona tem cooldown e custo. Varrer as quatro zonas esperando a janela da cabeça abrir passa a ser dominado, em valor esperado, pelo custo das trocas. Isso é o que torna a exploração economicamente ruim em vez de apenas difícil.

### 3. Commit-reveal

Parte do valor final vem de um segredo do servidor cujo **hash é enviado na abertura** do engajamento e revelado apenas na resolução. A curva desenhada continua honesta e **auditável depois do fato** — qualquer jogador pode verificar que o servidor não trapaceou —, mas não é integralmente predizível antes. É a mesma construção de um lançamento de moeda comprovável.

### 4. Detecção estatística

A distribuição de erro de timing de um humano tem cauda longa; a de um bot não tem. Sem GMs, essa detecção age sozinha.

**Duas regras que vêm da experiência de quem já errou isso:** rodar a detecção em **modo somente-log nas primeiras 4 a 6 semanas**, porque no dia do lançamento não existe linha de base populacional e um limiar calibrado contra bots sintéticos vai punir humanos com conexão ruim. E a resposta nunca é ban imediato — é rebaixamento silencioso para uma fila de suspeitos, com reavaliação.

### O teste que sustenta tudo isso

Em CI, dois bots jogam: um **sniper**, que lê a curva e cronometra perfeitamente, e um **humano sintético**, com latência de reação log-normal (média ~250 ms, σ ~150 ms). O teste falha se a taxa de morte por cabeça do sniper ficar acima da tolerância configurada em relação ao humano, ou se o dano por segundo dele for maior.

Isso transforma todo o argumento acima de prosa em regressão executável — e vai pegar o dia em que alguém "melhorar" o tempo de golpe e reabrir a brecha sem perceber.

## Dano por ângulo

O ângulo relativo entre atacante e alvo multiplica o dano depois da resolução de zona:

```text
        frente 1.0×
             ▲
   flanco    │    flanco
    1.5×  ◀──┼──▶  1.5×
             │
             ▼
       costas 2.5×
```

Cabeça pelas costas é execução. Elmo converte o letal em dano alto em vez de morte — e é por isso que capacete é o item mais disputado do loot.

## Descanso: a restrição virou conteúdo

O problema óbvio: o que impede alguém de descansar no meio de uma zona full PvP?

A resposta não é uma proibição, é a matemática do próprio descanso. Enquanto descansa, você **conta como ângulo 180° para todo mundo** — todo golpe é pelas costas —, recebe multiplicador de dano, e a condição de golpe letal na cabeça fica automaticamente satisfeita. Descansar em zona contestada é suicídio **por construção**. Nenhuma regra precisou ser escrita.

Além disso, o descanso profundo exige um **acampamento**: um objeto colocável, visível, destrutível, que cria um raio protegido. Isso converte a restrição em conteúdo — "descansar em zona de PvP" passa a significar "estabelecer um acampamento, que é um objetivo que outros jogadores vão vir destruir". É uma resposta melhor do que qualquer proibição.

## Problemas abertos

Duas lacunas honestas, que precisam de decisão **antes** de qualquer teste de PvP:

**Combate em grupo é o mais sério.** N atacantes contra um alvo significam N engajamentos independentes com oscilações independentes. Focar a mesma zona é trivialmente coordenável e a chance de morte por cabeça escala linearmente com o número de atacantes. Sem correção, o jogo vira "quem trouxer três amigos ganha instantaneamente". A direção provável é um termo de retorno decrescente por alvo, proporcional ao número de engajamentos ativos recebidos, aplicado só à cabeça.

**Arma à distância.** O modelo de zonas funciona, mas ângulo e linha de visão interagem de forma estranha a 20 tiles — "acertar pelas costas com flecha" não deveria valer `2.5×`. Provavelmente exige decaimento do multiplicador de ângulo com a distância.

## O maior risco: pode não ser divertido

O commit atrasado e o custo de troca foram escolhidos por razões de anti-cheat, e ambos **reduzem deliberadamente a agência imediata do jogador**. Existe uma chance real de que a versão endurecida contra cheat pareça mole ou arbitrária de jogar.

Isso é o maior risco de produto do projeto e o mais barato de eliminar: **construir um protótipo de uma semana, single-player, sem servidor, só com a tabela oscilante, a barra de commit e a resolução — e jogar.** Todo o resto da arquitetura é engenharia de MMO padrão que será necessária de qualquer forma. Este documento é a aposta, e uma aposta se testa antes de apostar mais.

## Referências

- [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) — servidor autoritativo, compensação de lag por rewind (~1 s, configurável por `sv_maxunlag`), e o aviso de que hit detection não é pixel-perfect. Verificado em 2026-07-29; a página registra edição em 2026-07-05 e já cobre Source 2 / CS2 com sub-tick.
- [Lag compensation](https://developer.valvesoftware.com/wiki/Lag_compensation) — confirma que por padrão só jogadores são rebobinados, e apenas 1 s de histórico é mantido.
- [`docs/03-arquitetura/`](../03-arquitetura/) — tick rate, formato de wire, AOI e a transação de morte.
- [`docs/06-anti-cheat/`](../06-anti-cheat/) — detecção estatística e moderação sem GMs.

**Não verificado:** os valores concretos de média, amplitude e frequência por zona; a janela de commit em ticks; e o termo de retorno decrescente para combate em grupo. Todos dependem do protótipo de feel.

**Última atualização:** 2026-07-29
