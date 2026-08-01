/**
 * Busca do CharacterDetail — o passo que fecha o create-character-v3.
 *
 * O create-character-v3 é assíncrono e o background job dele NÃO carrega
 * pixels. Confirmado no spec vendorizado
 * (tools/pixellab-pipeline/openapi/openapi-v2.json, BackgroundJobResponse) e
 * contra a API real em 2026-08-01: o `last_response` de um job concluído traz
 * `{character_id, character_name, directions_count, uploaded_directions,
 * saved_to_storage}` — metadado puro. As imagens só existem em
 * `GET /characters/{character_id}`, no campo `rotation_urls`, e o próprio spec
 * avisa: "rotation_urls is null unless status == 'completed'".
 *
 * Esse detalhe custou 14 submissões pagas neste repositório sem UM PNG em
 * disco: o código antigo passava o `last_response` direto para
 * parseAndWriteFrames, que não achava imagem nenhuma e morria depois da
 * cobrança. Por isso este módulo existe separado — o caminho de volta ao
 * artefato pago é uma etapa nomeada, não um detalhe dentro de outra função.
 *
 * A espera extra é real e não é paranoia: o job vira 'completed' quando a
 * geração termina, mas a LINHA do personagem só vira 'completed' depois do
 * upload dos frames e da reconstrução do esqueleto 3D (descrição do campo
 * `character_id` em CreateCharacterV3Response). Existe uma janela em que o job
 * está pronto e `rotation_urls` ainda é null.
 */
import type { PixelLabClient } from '../../pixellab-pipeline/src/api.ts';
import { sleep } from '../../pixellab-pipeline/src/util.ts';

/** Recorte do CharacterDetail que interessa a quem grava frames. */
export interface CharacterDetail {
  readonly id: string;
  /** 'completed' | 'failed' | 'pending' (default 'completed' no spec). */
  readonly status?: string;
  /** 4 ou 8. */
  readonly directions?: number;
  /** Direção → URL pública do PNG. null enquanto status !== 'completed'. */
  readonly rotation_urls?: Record<string, string | null> | null;
  readonly size?: { readonly width: number; readonly height: number };
  readonly group_id?: string | null;
  readonly skeletons?: unknown;
}

/** A geração do personagem terminou em falha do lado da PixelLab. */
export class CharacterFailedError extends Error {
  readonly characterId: string;

  constructor(characterId: string) {
    super(
      `o personagem ${characterId} terminou com status "failed" na PixelLab — ` +
        'a geração foi cobrada mas não produziu imagens.',
    );
    this.name = 'CharacterFailedError';
    this.characterId = characterId;
  }
}

/** O personagem existe mas não ficou pronto dentro da janela de espera. */
export class CharacterTimeoutError extends Error {
  readonly characterId: string;

  constructor(characterId: string, elapsedMs: number) {
    super(
      `o personagem ${characterId} ainda não tinha rotation_urls depois de ` +
        `${Math.round(elapsedMs / 1000)}s. A geração foi paga e o artefato existe: ` +
        'reabra a bancada mais tarde — o cache reaproveita sem cobrar de novo.',
    );
    this.name = 'CharacterTimeoutError';
    this.characterId = characterId;
  }
}

export interface WaitOptions {
  /** Teto absoluto da espera. Default 180s. */
  readonly timeoutMs?: number;
  /** Intervalo entre sondagens. Default 3s. */
  readonly intervalMs?: number;
  readonly onLog?: ((m: string) => void) | undefined;
}

/**
 * Sonda `GET /characters/{id}` até `status === 'completed'` COM
 * `rotation_urls` populado, e devolve o detalhe.
 *
 * Só as duas condições juntas contam como pronto: o spec permite
 * `status: 'completed'` com `rotation_urls: null` durante o upload, e
 * devolver isso seria trocar um erro claro por frames vazios.
 */
export async function waitForCharacterRotations(
  client: PixelLabClient,
  characterId: string,
  opts: WaitOptions = {},
): Promise<CharacterDetail> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const started = Date.now();

  for (;;) {
    const res = await client.request<CharacterDetail>(
      'GET',
      `/characters/${encodeURIComponent(characterId)}`,
    );
    const detail = res.data;
    const status = detail?.status ?? 'completed';

    if (status === 'failed') throw new CharacterFailedError(characterId);

    const urls = detail?.rotation_urls;
    if (status === 'completed' && urls && Object.keys(urls).length > 0) {
      return detail;
    }

    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) throw new CharacterTimeoutError(characterId, elapsed);
    opts.onLog?.(
      `[character] ${characterId} status=${status} sem rotation_urls — ` +
        `nova sondagem em ${intervalMs / 1000}s.`,
    );
    await sleep(intervalMs);
  }
}
