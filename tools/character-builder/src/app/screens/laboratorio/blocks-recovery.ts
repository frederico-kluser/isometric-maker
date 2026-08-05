/**
 * Recolagem da bancada de blocos a um job que já está no servidor — módulo puro.
 *
 * ## O defeito que este módulo apaga
 *
 * `blocks-panel.tsx` guardava o hash da corrida em `useState`. Ele volta uma vez
 * só, no corpo do 202 do `POST /api/world-block`, e some com o componente. Um F5
 * no meio de uma geração e a tela voltava dizendo "nenhum resultado ainda" em
 * cima de um bloco pago que continuava sendo gerado no servidor — a corrida
 * seguia, a sondagem não. Com fila e várias gerações enfileiradas, a janela
 * deixou de ser um instante e passou a ser minutos.
 *
 * A cura já existia a duas telas de distância: o painel de personagem
 * (`studio-recovery.ts`) reconstrói o hash a partir da CHAVE do job. A chave é
 * `world-block::<hash>` (`server/api.ts`), e o `studio.jobs` chega a cada
 * sondagem de `/api/studio`. Nada precisa ser guardado no navegador: o servidor
 * é a memória.
 *
 * ## A guarda é de DONO, e a versão anterior confundia dono com rastreado
 *
 * A entrada era `tracked` — "o hash que a tela sonda AGORA", ou seja
 * `pendingHash` —, justificada como se fosse a mesma coisa que o `owned` do
 * irmão. Não é, e a diferença tem duas consequências pagas:
 *
 *   1. `pendingHash` volta a `null` no instante em que o resultado chega
 *      (`setPendingHash(null)` no sucesso da sondagem). O `GET
 *      /api/world-block/<hash>` lê o resultado DO DISCO, que `runWorldBlock`
 *      grava antes de a promessa resolver e a fila marcar `'pronto'` — então o
 *      snapshot do estúdio em mão ainda diz `'gerando'` (e pode estar até 3 s
 *      atrasado por cima disso). Com `tracked === null`, a tela recolava na
 *      PRÓPRIA corrida já entregue: o bloco sumia, o skeleton voltava e a nota
 *      "reencontrei uma geração em andamento" aparecia sobre o que o usuário
 *      acabara de receber. Caminho feliz, sem corrida de relógio.
 *   2. Entre o clique em "Gerar" e o 202 não existe hash nenhum, e `tracked`
 *      era `null` também aí. Um `world-block::*` de outra aba em voo tomava a
 *      tela, e o bloco recém-pedido — pago — ficava sem ninguém acompanhando.
 *
 * Por isso a entrada agora é `OwnedBlockRun | null`, exatamente como
 * `planReattach`: `null` é tela órfã (todo snapshot novo é uma chance de
 * recolar), `{hash: null}` é a janela do 202, e `{hash: X}` é a corrida desta
 * montagem. A partir do momento em que há dono, nada rouba a tela dele.
 *
 * A outra diferença em relação ao irmão continua valendo: `'na-fila'` conta
 * desde o primeiro dia aqui, porque este módulo nasceu depois da fila. O
 * predicado é `isBusyStatus`, o mesmo de `src/app/job-scope.ts`.
 *
 * Separado da tela para rodar sob `node --test` sem DOM.
 */
import { isBusyStatus, type BusyStatus } from '../../job-scope.ts';

/** Recorte de `studio.jobs[key]` que interessa aqui. */
export interface BlockJobSnapshot {
	readonly status: string;
}

/**
 * A corrida que ESTA montagem da bancada possui — recolada de um job em voo ou
 * disparada pelo botão "Gerar" daqui.
 *
 * Mesma forma de `OwnedRun` (`./studio-recovery.ts`) e mesmo significado, sem
 * importar de lá: os dois painéis são vizinhos e independentes, e cada um
 * declara o próprio vocabulário (a mesma razão de `BlockJobSnapshot` existir ao
 * lado de `JobSnapshot`).
 *
 * `hash: null` é a janela entre o clique em "Gerar" e a chegada do 202 — a
 * montagem já tem dono, o hash dele ainda não voltou do servidor.
 */
export interface OwnedBlockRun {
	readonly hash: string | null;
}

/**
 * Prefixo da chave de job da bancada de blocos (`server/api.ts` monta
 * `world-block::<hash>`). O hash sai da própria chave — é o único lugar onde ele
 * sobrevive a um remount do painel.
 */
export const BLOCK_JOB_KEY_PREFIX = 'world-block::';

/**
 * Formato do hash de `worldBlockHash` — sha256 cortado em 16 hex
 * (`server/world-block.ts`). O teste existe para não recolar em chave estranha:
 * `world-block::` seguido de qualquer coisa viraria uma sondagem infinita em
 * `/api/world-block/<lixo>`.
 */
const HASH_RE = /^[a-f0-9]{16}$/i;

export type BlockReattachPlan =
	/** Ainda não houve snapshot do estúdio — decidir agora seria decidir cedo. */
	| { readonly kind: 'wait' }
	/** Snapshot lido, nada a recolar AGORA. Não é decisão definitiva. */
	| { readonly kind: 'none' }
	| {
			readonly kind: 'reattach';
			readonly hash: string;
			readonly key: string;
			/** `'na-fila'` e `'gerando'` recolam igual e se escrevem diferente. */
			readonly status: BusyStatus;
	  };

/**
 * Decide se a bancada deve (voltar a) sondar um bloco que está no servidor.
 *
 * A primeira pergunta é de DONO, não de conteúdo: uma montagem que já possui
 * corrida não troca o que acompanha por baixo, aconteça o que acontecer no
 * snapshot. Só a tela órfã escolhe — ver o cabeçalho.
 *
 * A escolha é determinística: quem está `'gerando'` ganha de quem está
 * `'na-fila'` — é o que está gastando agora —, e entre iguais vence a menor
 * chave, porque ordem de iteração de objeto não é contrato e duas telas com o
 * mesmo snapshot têm de escolher o mesmo bloco. A ordem FIFO de verdade fica no
 * painel da fila; aqui basta escolher UM, sempre o mesmo.
 */
export function planBlockReattach(
	jobs: Readonly<Record<string, BlockJobSnapshot>> | undefined,
	owned: OwnedBlockRun | null = null,
): BlockReattachPlan {
	if (jobs === undefined) return { kind: 'wait' };
	// A tela já tem corrida própria — inclusive `{hash: null}`, a janela entre o
	// clique em "Gerar" e o 202. Sem isto, o snapshot atrasado do estúdio apaga
	// o resultado recém-entregue, e um job de outra aba rouba a tela de um
	// bloco que acabou de ser pedido.
	if (owned !== null) return { kind: 'none' };

	let chosen: { key: string; hash: string; status: BusyStatus } | undefined;
	for (const key of Object.keys(jobs).sort()) {
		if (!key.startsWith(BLOCK_JOB_KEY_PREFIX)) continue;
		const status = jobs[key]?.status;
		if (!isBusyStatus(status)) continue;
		const hash = key.slice(BLOCK_JOB_KEY_PREFIX.length);
		if (!HASH_RE.test(hash)) continue;
		if (chosen === undefined || (chosen.status !== 'gerando' && status === 'gerando')) {
			chosen = { key, hash, status };
		}
	}
	if (chosen === undefined) return { kind: 'none' };
	return { kind: 'reattach', hash: chosen.hash, key: chosen.key, status: chosen.status };
}
