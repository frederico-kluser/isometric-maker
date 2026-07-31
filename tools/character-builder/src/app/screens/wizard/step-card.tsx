/**
 * Moldura de um passo do wizard: Card shadcn com o estado da trilha no
 * cabeçalho. Passo "todo" renderiza só o cabeçalho esmaecido — a cadeia
 * inteira fica visível antes de ser alcançada, sem expor controles que
 * ainda não podem funcionar.
 *
 * Código novo porque o registry @motion não tem stepper/card-de-passo com
 * este contrato; o visual é 100% tokens shadcn sobre o Card instalado.
 */
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { wizard } from '../../../strings/wizard.ts';
import type { StepStatus } from './wizard-progress.ts';

const STATUS_LABEL: Record<StepStatus, string> = {
	done: wizard.trilha.concluido,
	active: wizard.trilha.atual,
	todo: wizard.trilha.pendente,
};

export interface StepCardProps {
	readonly title: string;
	readonly note?: string | undefined;
	readonly status: StepStatus;
	readonly children?: ReactNode;
}

export function StepCard({ title, note, status, children }: StepCardProps) {
	return (
		<Card className={cn(status === 'todo' && 'opacity-60')}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					{title}
				</CardTitle>
				<CardAction>
					<Badge
						variant={
							status === 'done'
								? 'secondary'
								: status === 'active'
									? 'default'
									: 'outline'
						}
					>
						{status === 'done' ? (
							<Check aria-hidden className="size-3" />
						) : null}
						{STATUS_LABEL[status]}
					</Badge>
				</CardAction>
				{note ? <CardDescription>{note}</CardDescription> : null}
			</CardHeader>
			{status !== 'todo' && children ? (
				<CardContent className="flex flex-col gap-4">{children}</CardContent>
			) : null}
		</Card>
	);
}
