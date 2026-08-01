# Manequim e enquadramento — como forçar um corpo-base e fazer o sprite preencher o quadro

> **Quick Start (TL;DR)**
>
> Ligue **Modo manequim** no passo da face sul e escreva só o estilo. O seletor `Esqueleto para animação` **não** faz isso — ele escolhe o esqueleto da animação. O preenchimento do quadro é o toggle da configuração, e vem ligado.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder
> npm run dev          # o wizard sobe em http://localhost:5174
> npm run typecheck && npm test
> ```

## O que estava acontecendo

Duas queixas com causas diferentes.

**"Escolho manequim e vem vestido."** O seletor rotulado `Corpo` era o `template_id` do
`/create-character-v3`. No spec vendorizado
(`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`, capturado
em 2026-08-01) ele é "Body type for skeleton reconstruction" — escolhe o esqueleto 3D que o animador
encaixa nos quadros, para o personagem poder ser animado. `mannequin` quer dizer **bípede**. Não tira
roupa, não tira cabelo, não tira rosto. O rótulo foi corrigido para `Esqueleto para animação`.

**"O sprite fica pequeno no centro."** O `/create-character-v3` documenta: "Final canvas is padded ~2x
for animation room (capped at 256)". Medido nos arquivos deste repositório, pedindo 128 px voltam
quadros de 172×172 com o personagem ocupando 66% da altura. Não há parâmetro para desligar.

## Modo manequim

No passo **Face sul**, a caixa `Modo manequim`. Com ela ligada:

- o seu texto vira **estilo**, não personagem — o rótulo do campo muda para `Estilo`;
- o corpo é anexado por um andaime fixo (careca, sem rosto, sem roupa, pose neutra);
- um `negative_description` fixo entra no request, listando roupa, cabelo, barba, olhos, boca,
  armadura, chapéu, arma e afins;
- `coverage_percentage` vai como 92, para o sprite ocupar quase todo o quadro na geração da sul;
- um campo `Negativo extra` aparece, concatenado ao negativo padrão.

O que faz o trabalho de verdade é o **negativo**. "Sem roupa" no positivo é pedido fraco: quase todo
personagem do conjunto de treino tem roupa, e sem negativo o modelo volta ao hábito.

A descrição efetiva (estilo + andaime) é a que segue para as 8 direções. Mandar o texto cru lá
reintroduziria no giro a roupa que a sul não tem.

```text
Estilo digitado:  ragnarok online 2002 korean pixel art, cel-shaded, bold dark outlines
description:      ragnarok online 2002 korean pixel art, cel-shaded, bold dark outlines,
                  featureless humanoid base body mannequin, completely bald head with no hair,
                  blank faceless head with no eyes, no nose, no mouth, ...
negative_desc.:   clothes, clothing, shirt, ... hair, hairstyle, beard, ... eyes, ... weapon, ...
```

O modo é **por personagem**. O corpo-base nasce com ele ligado; personagens derivados nascem com ele
desligado, porque derivado é para ficar vestido.

## Preenchimento do quadro

Na configuração, `Preencher o quadro nas 8 direções` — ligado por padrão. Depois do download das oito
direções:

1. os oito PNGs são decodificados;
2. calcula-se a caixa de alfa **unida** das oito;
3. a caixa vira quadrado, crescendo o lado menor pelo centro;
4. todas as oito são reamostradas com o **mesmo** retângulo, nearest-neighbor, para `lock.size`.

A união é o ponto inteiro. Recortar cada direção com a caixa própria parece mais preciso e faz o
personagem mudar de tamanho ao girar — a silhueta de sudeste tem cerca de metade da largura da de sul.

O PNG original vai para `raw/` **antes** do recorte, e uma segunda passada lê de `raw/`. Sem isso,
rodar duas vezes recortaria o recorte e o personagem encolheria a cada execução.

## Armadilhas

- **O andaime não vence um estilo que descreve roupa.** Se o texto disser "wizard with blue robes",
  isso continua sendo estilo enviado ao modelo e a roupa pode voltar. Escreva estilo: paleta, época,
  jogo de referência, tipo de contorno.
- **`detail` e `outline` não valem no giro.** O `create-character-v3` os ignora quando há
  `reference_image` — eles só afetam a sul, gerada pelo bitforge.
- **Editar a sul (`/edit-image`) não tem negativo.** O endpoint não declara `negative_description`; se
  uma edição trouxer roupa de volta, o caminho é refazer a sul, não editar.
- **Ligar o modo manequim com o mesmo texto gera de novo, e cobra.** A descrição efetiva mudou, então
  não é repetição. É o comportamento correto e custa uma geração.
- **O recorte é destrutivo no arquivo público.** O original só existe em `raw/`. Apagar `raw/` e rodar
  de novo recortaria o recorte.

## O que não foi verificado

- **Nenhuma geração real foi feita para validar isto.** Os campos existem no spec, o request os
  carrega e os testes provam o recorte sobre imagens sintéticas — mas o efeito de
  `negative_description` e `coverage_percentage` na arte **não foi observado contra a API**.
- **92% de cobertura é escolha, não medição.** Não há amostra dizendo qual valor enquadra melhor.
- **Quanto o `create-character-v3` estufa a moldura varia.** O spec diz "~2x"; a medição deu 1,34x
  para um pedido de 128 px.

## Referências

- [ADR 0024](../adr/0024-modo-manequim-e-preenchimento-do-quadro.md) — a decisão e o porquê
- [ADR 0019](../adr/0019-create-character-v3-e-o-caminho-do-personagem.md) — por que a v3
- [`tools/character-builder/server/mannequin-prompt.ts`](../../tools/character-builder/server/mannequin-prompt.ts) — o andaime e os negativos
- [`tools/character-builder/server/frame-fit.ts`](../../tools/character-builder/server/frame-fit.ts) — o recorte comum
- [`docs/01-pixellab/custos-e-limites.md`](../01-pixellab/custos-e-limites.md) — custo estimado por endpoint

**Última atualização:** 2026-08-01
