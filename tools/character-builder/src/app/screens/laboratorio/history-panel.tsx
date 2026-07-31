/**
 * Histórico da sessão do laboratório — estado local da tela, some ao
 * recarregar (diz a própria linha de lista vazia). Cada linha: thumbnail
 * pixelado do resultado, resumo dos parâmetros e horário.
 */
import { Badge } from '@/components/ui/badge';
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { laboratorio as SL } from '../../../strings/laboratorio.ts';

export interface HistoryEntry {
	readonly id: number;
	readonly at: Date;
	/** data URI do PNG rotacionado (thumbnail). */
	readonly thumbDataUri: string;
	/** Resumo dos parâmetros da execução (resumoDirecoes/resumoAngulos). */
	readonly summary: string;
	/** true quando o servidor devolveu do cache (sem usage na resposta). */
	readonly fromCache: boolean;
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
});

export function HistoryPanel({
	entries,
}: {
	readonly entries: readonly HistoryEntry[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{SL.historico.titulo}</CardTitle>
			</CardHeader>
			<CardContent>
				{entries.length === 0 ? (
					<p className="text-sm text-muted-foreground">{SL.historico.vazio}</p>
				) : (
					<ScrollArea className="h-64">
						<ul className="flex flex-col gap-2 pr-3">
							{entries.map((e) => (
								<li
									key={e.id}
									className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-2 py-2"
								>
									<img
										src={e.thumbDataUri}
										alt=""
										className="size-10 shrink-0 rounded-sm border border-border object-contain [image-rendering:pixelated]"
									/>
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm">{e.summary}</span>
										<span className="text-xs text-muted-foreground">
											{timeFmt.format(e.at)}
										</span>
									</div>
									{e.fromCache && (
										<Badge variant="secondary">{SL.resultado.cacheSelo}</Badge>
									)}
								</li>
							))}
						</ul>
					</ScrollArea>
				)}
			</CardContent>
		</Card>
	);
}
