/**
 * O caminho de volta ao artefato pago, em disco (ADR 0023, regra 1).
 *
 * ## O que este módulo é
 *
 * Uma definição única de três gestos que, juntos, são a metade do contrato que
 * `server/job-queue.ts` exige do executor e que só `server/world-block.ts`
 * cumpria:
 *
 *   1. **Gravar** o identificador remoto ASSIM QUE a resposta da submissão
 *      chega — antes do primeiro poll, antes de qualquer download.
 *   2. **Procurar** esse identificador ANTES de submeter. Achando, o módulo
 *      re-sonda: `GET /background-jobs/{id}` e `GET /characters/{id}` não
 *      custam nada, e uma submissão nova custa a geração inteira de novo.
 *   3. **Descartar** quando o artefato finalmente chega ao disco.
 *
 * "Money leaves on submit, value arrives on download." Entre esses dois
 * momentos o identificador é a única coisa entre nós e pagar duas vezes.
 *
 * ## Por que o stub mora ao lado do artefato, e não dentro da fila
 *
 * A fila também guarda um identificador (`QueuedJob.remote`, escrito por
 * `ctx.markPaid`) e ele é lido onde existe. Mas o stub é a memória do MÓDULO
 * GERADOR, e é ela que `canResumeWithoutSpending` afirma existir:
 *
 *   - `runSpriteLab` e as funções de `mannequin.ts` são chamadas direto pelos
 *     próprios testes e não dependem da fila para nada. Uma retomada que só
 *     morasse em `job-queue.json` evaporaria fora dela.
 *   - `RemoteHandle` é UM objeto plano por job. O Sprite Studio tem um
 *     `character_id` POR CANDIDATO (até quatro), e não há onde pôr isso sem
 *     mexer na fila.
 *   - O caminho do stub é derivado do caminho do ARTEFATO. Um pedido diferente
 *     escreve um artefato diferente e por construção não acha o stub do outro —
 *     é a mesma isolação que `world-block.ts` ganha de graça por ter o hash da
 *     config no diretório. Um campo plano numa chave de fila estável não tem
 *     essa propriedade e poderia retomar o id errado.
 *
 * ## A janela que isto NÃO fecha
 *
 * Entre a submissão ser aceita e o stub chegar ao disco existe um intervalo em
 * que o dinheiro já saiu e nada foi anotado. É irredutível aqui: o
 * identificador só existe DEPOIS da resposta. Só uma chave de idempotência
 * aceita pelo fornecedor fecharia isso de verdade, e o spec vendorizado não
 * documenta nenhuma. Escrever o stub na PRIMEIRA linha depois do `submit`
 * encolhe a janela ao mínimo possível — não a elimina.
 *
 * O formato do arquivo é o mesmo que `world-block.ts` já grava
 * (`<artefato>.pending.json`, JSON de uma linha), de propósito: quem for
 * limpar o disco vê um padrão só.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * O conteúdo do stub. Espelha `RemoteHandle` de `server/job-queue.ts` de
 * propósito — os dois respondem à mesma pergunta ("por onde eu volto ao que já
 * paguei?") e o mesmo objeto serve aos dois sem conversão.
 */
export interface PendingStub {
  /** `background_job_id`. Animação devolve um POR DIREÇÃO. */
  readonly jobIds?: readonly string[];
  /** `character_id` — a v3 só entrega pixels em `GET /characters/{id}`. */
  readonly characterId?: string;
  /** `tile_id`, `object_id`… para as famílias com poll por recurso. */
  readonly resourceId?: string;
  /** ISO da submissão. Serve para o humano que for ler o arquivo. */
  readonly at?: string;
  /** Texto livre: o que era o pedido, para quem abrir o arquivo depois. */
  readonly note?: string;
}

/** `<artefato>.pending.json` — o mesmo sufixo de `world-block.ts`. */
export function pendingStubPath(artifactPath: string): string {
  return `${artifactPath}.pending.json`;
}

/**
 * Impressão do PEDIDO, para quando o caminho do artefato não identifica o que
 * foi pedido.
 *
 * `world-block.ts` e `sprite-lab.ts` não precisam disto: o hash da config já
 * está no caminho do arquivo. O wizard precisa — `south-v3.png` é o mesmo
 * caminho para dois prompts de edição diferentes, e retomar o stub errado
 * entregaria a arte de OUTRO pedido. Com a impressão no nome, um pedido
 * diferente simplesmente não acha stub e submete o que de fato é trabalho novo.
 *
 * Curto de propósito (8 hex): é desambiguação dentro de um diretório de um
 * personagem, não hash criptográfico de conteúdo.
 */
export function requestFingerprint(parts: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(parts) ?? 'undefined')
    .digest('hex')
    .slice(0, 8);
}

/**
 * Grava o stub. CHAME LOGO DEPOIS DA SUBMISSÃO, antes do primeiro poll, e
 * AGUARDE — o `await` é o que garante que o disco saiba antes de a espera longa
 * começar.
 */
export async function writePendingStub(
  path: string,
  stub: PendingStub,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const conteudo: PendingStub = { at: new Date().toISOString(), ...stub };
  await writeFile(path, `${JSON.stringify(conteudo)}\n`);
}

/**
 * Lê o stub, ou `null` quando não existe, não é JSON ou não tem identificador
 * nenhum.
 *
 * Um stub sem identificador é lixo, e devolvê-lo faria o chamador achar que
 * tem retomada quando não tem. Nunca lança: erro de leitura aqui só pode
 * empurrar para o lado que GASTA, então ele é tratado como ausência e o
 * chamador decide (que é submeter) com o log na mão.
 */
export async function readPendingStub(
  path: string,
): Promise<PendingStub | null> {
  if (!existsSync(path)) return null;
  let parsed: PendingStub;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as PendingStub;
  } catch {
    return null;
  }
  const temJob =
    Array.isArray(parsed?.jobIds) &&
    parsed.jobIds.some((id) => typeof id === 'string' && id.length > 0);
  const temChar =
    typeof parsed?.characterId === 'string' && parsed.characterId.length > 0;
  const temRecurso =
    typeof parsed?.resourceId === 'string' && parsed.resourceId.length > 0;
  if (!temJob && !temChar && !temRecurso) return null;
  return parsed;
}

/**
 * Apaga o stub. Chame SÓ depois de o artefato estar em disco — apagar antes é
 * jogar fora o caminho de volta.
 *
 * Falha de `unlink` é engolida de propósito: um stub que sobrou é relido na
 * próxima execução e leva a uma sondagem gratuita; derrubar aqui perderia um
 * artefato que já chegou.
 */
export async function discardPendingStub(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}
