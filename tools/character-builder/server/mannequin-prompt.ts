/**
 * Andaime de prompt do modo manequim.
 *
 * ## Por que existe
 *
 * `template_id: "mannequin"` do `/create-character-v3` **não** é aparência. Texto
 * literal do spec vendorizado (2026-08-01):
 *
 * > "Body type for **skeleton reconstruction**. Picks the 3D template the skeleton
 * > estimator fits to the generated frames so the character can be animated."
 *
 * E o único efeito de `template_id` sobre o texto, documentado em
 * `/create-character-pro`, é para quadrúpedes: "Quadruped templates also append
 * ', on all fours' to the description". Para `mannequin` não há efeito nenhum
 * sobre o desenho. Escolher "manequim" no seletor de corpo e esperar um corpo-base
 * pelado é a armadilha que este módulo fecha.
 *
 * A aparência sai inteira do `description` do `/create-image-bitforge`, o passo da
 * sul. Então é ali que o manequim tem de ser forçado — com um andaime positivo e,
 * principalmente, com `negative_description`, que o `CreateImageBitforgeRequest`
 * declara ("Text description of what to avoid in the generated image") e que o
 * wizard nunca tinha enviado.
 *
 * ## Contrato
 *
 * No modo manequim o texto do usuário é tratado como **estilo**, não como
 * personagem: entra na frente, e o corpo vem do andaime. O usuário escreve
 * "ragnarok online 2002, cel-shaded" e recebe um manequim naquele estilo.
 */

/**
 * Andaime positivo. Descreve o corpo, nunca o estilo — o estilo é do usuário.
 *
 * Em inglês porque é dado enviado à API, como todo prompt deste projeto.
 */
export const MANNEQUIN_BODY =
  'featureless humanoid base body mannequin, ' +
  'completely bald head with no hair, ' +
  'blank faceless head with no eyes, no nose, no mouth, ' +
  'smooth untextured skin, uniform flat skin color, ' +
  'wearing no clothing at all, no armor, no accessories, ' +
  'neutral standing pose, arms slightly away from the body, ' +
  'symmetrical, single character, full body visible from head to feet';

/**
 * Negativo. O que o modelo insiste em desenhar quando ninguém pede o contrário —
 * roupa, cabelo e rosto são os três reincidentes.
 *
 * "cropped" e "cut off" estão aqui porque um corpo cortado pela moldura é o efeito
 * colateral típico de pedir cobertura alta do quadro.
 */
export const MANNEQUIN_NEGATIVE =
  'clothes, clothing, shirt, tunic, pants, trousers, skirt, dress, robe, cloak, cape, ' +
  'armor, chainmail, hat, helmet, hood, mask, shoes, boots, gloves, belt, bag, backpack, ' +
  'jewelry, hair, hairstyle, beard, moustache, ' +
  'eyes, eyebrows, nose, mouth, ears, face, facial features, facial expression, ' +
  'weapon, sword, shield, staff, ' +
  'background, ground, floor, shadow, text, logo, watermark, ' +
  'multiple characters, cropped, cut off, close-up';

/**
 * Cobertura padrão do quadro no modo manequim, em porcentagem.
 *
 * `coverage_percentage` existe só no `/create-image-bitforge` (0–100, "Percentage
 * of the canvas to cover") e nunca tinha sido enviado. 92 e não 100 porque o
 * contorno precisa de um pixel de folga para não encostar na borda — e um sprite
 * encostado na borda perde o contorno quando vira atlas.
 */
export const MANNEQUIN_COVERAGE = 92;

/** O que sai daqui e entra no corpo do request. */
export interface MannequinPrompt {
  /** Vai em `description`. */
  readonly description: string;
  /** Vai em `negative_description`. */
  readonly negativeDescription: string;
}

/**
 * Monta o prompt do modo manequim a partir do estilo escrito pelo usuário.
 *
 * @param style Texto do usuário. Tratado como estilo, não como personagem.
 * @param extraNegative Negativo adicional do usuário, concatenado ao padrão.
 */
export function buildMannequinPrompt(
  style: string,
  extraNegative?: string,
): MannequinPrompt {
  // Tira um andaime que já esteja no texto antes de anexar o próximo. Sem isto,
  // regerar a partir de `Character.description` — que guarda a descrição EFETIVA —
  // empilharia "estilo, ANDAIME, ANDAIME" e cada rodada ficaria mais longa.
  const estilo = style
    .replaceAll(MANNEQUIN_BODY, '')
    .trim()
    .replace(/[,\s]+$/, '')
    .replace(/^[,\s]+/, '');
  const extra = extraNegative?.trim().replace(/^[,\s]+|[,\s]+$/g, '');
  return {
    description: estilo ? `${estilo}, ${MANNEQUIN_BODY}` : MANNEQUIN_BODY,
    negativeDescription: extra
      ? `${MANNEQUIN_NEGATIVE}, ${extra}`
      : MANNEQUIN_NEGATIVE,
  };
}

/**
 * Descrição efetiva de um passo da sul: o andaime quando o modo manequim está
 * ligado, o texto cru quando não está.
 *
 * É esta string que vai para o `description` do `/create-character-v3` nas 8
 * direções — mandar o texto cru ali reintroduziria a roupa que a sul não tem.
 */
export function effectiveDescription(
  rawPrompt: string,
  mannequin: boolean | undefined,
): string {
  return mannequin ? buildMannequinPrompt(rawPrompt).description : rawPrompt;
}
