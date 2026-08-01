/**
 * Strings da aba Laboratório — Sprite Studio (seção `studio`, bancada v3) e
 * playground livre do endpoint /rotate (seções raiz).
 * Chaves em inglês, valores em pt-BR (ADR 0008, ADR 0016).
 *
 * Strings parametrizadas (com interpolação) são funções exportadas no fim
 * do arquivo, importadas pela tela diretamente deste módulo — o barrel
 * `src/strings.ts` pertence a outro agente e não é editado aqui.
 *
 * Nomes de parâmetros da API (from_direction, view_change…) aparecem entre
 * parênteses nos rótulos de propósito: esta tela é um playground da API e o
 * usuário quer reconhecer nela os campos do spec.
 */

export const laboratorio = {
	/** Cabeçalho do painel */
	titulo: 'Laboratório de rotação',
	/** Descrição sob o cabeçalho */
	descricao:
		'Playground do endpoint /rotate: envie uma imagem, escolha a rotação e compare ' +
		'original e resultado lado a lado. Uma chamada por execução, síncrona.',

	// ── upload da imagem ─────────────────────────────────────────
	upload: {
		/** Título do cartão de upload */
		titulo: 'Imagem',
		/** Dropzone vazia */
		vazio: 'Arraste um PNG ou JPG aqui, ou clique para escolher',
		/** Dropzone com imagem carregada */
		trocar: 'Clique ou solte outra imagem para trocar',
		/** Arquivo que não é PNG nem JPG */
		formatoInvalido: 'formato inválido — só aceito PNG ou JPG',
		/** Falha ao ler ou decodificar o arquivo */
		leituraArquivo: 'não consegui ler o arquivo',
		/** Rótulo do campo de largura do imageSize */
		largura: 'Largura (px)',
		/** Rótulo do campo de altura do imageSize */
		altura: 'Altura (px)',
		/** Nota sob os campos de tamanho */
		notaTamanho:
			'image_size do /rotate: inteiros entre 16 e 200, preenchidos com as ' +
			'dimensões detectadas da imagem — edite à vontade.',
	},

	// ── modo de rotação ──────────────────────────────────────────
	modo: {
		/** Rótulo do segmented-toggle */
		rotulo: 'Modo de rotação',
		/** Nome acessível do grupo */
		ariaLabel: 'Modo de rotação',
		/** Opção: par from/to_direction */
		porDirecao: 'Por direção',
		/** Opção: direction_change/view_change em graus */
		porAngulos: 'Por ângulos',
	},

	// ── modo por direção ─────────────────────────────────────────
	direcoes: {
		/** Select from_direction */
		de: 'De (from_direction)',
		/** Select to_direction */
		para: 'Para (to_direction)',
		/** Select from_view */
		viewDe: 'View inicial (from_view)',
		/** Select to_view */
		viewPara: 'View final (to_view)',
		/**
		 * Aviso exibido só quando a view muda. O guia do próprio fornecedor
		 * diz que trocar a view de câmera "não é algo para que o modelo foi
		 * treinado" — girar dentro da mesma view é o uso confiável.
		 */
		avisoTrocaView:
			'Trocar a view de câmera é experimental: o guia do fornecedor avisa que o ' +
			'modelo não foi treinado para isso e o resultado é imprevisível. Girar ' +
			'dentro da mesma view é o caminho confiável.',
	},

	// ── modo por ângulos ─────────────────────────────────────────
	angulos: {
		/** Input direction_change */
		giro: 'Giro em graus (direction_change, -180 a 180)',
		/** Input view_change */
		inclinacao: 'Inclinação em graus (view_change, -90 a 90)',
		/** Nota sob os inputs */
		nota: 'Graus inteiros; 0 mantém o eixo como está.',
	},

	// ── accordion avançado ───────────────────────────────────────
	avancado: {
		/** Trigger do accordion */
		titulo: 'Avançado',
		/** Rótulo do segundo upload */
		initTitulo: 'Imagem inicial (init_image)',
		/** Dropzone do init_image vazia */
		initVazio: 'Opcional: arraste um PNG ou JPG, ou clique',
		/** Botão que remove o init_image */
		initRemover: 'Remover imagem inicial',
		/** Rótulo do slider de força */
		forca: 'Força (init_image_strength)',
		/** Nota do slider de força */
		forcaNota:
			'Inteiro de 1 a 999 (default do spec: 300). Só é enviada junto com a imagem inicial.',
		/** Rótulo do campo de seed */
		seed: 'Seed',
		/** Placeholder do campo de seed */
		seedPlaceholder: 'vazio = aleatório',
		/** Nota do campo de seed */
		seedNota:
			'Seed fixa é o único jeito de reproduzir um resultado; vazia, cada chamada ' +
			'gera uma imagem diferente.',
		/** Rótulo do checkbox isometric */
		isometrico: 'Isométrico (isometric)',
		/** Nota do checkbox isometric */
		isometricoNota:
			'Marcado, envia isometric: true; desmarcado, o parâmetro nem é enviado.',
	},

	// ── botão de execução ────────────────────────────────────────
	executar: {
		/** Estado inicial do multi-state-button */
		rotacionar: 'Rotacionar',
		/** Estado durante a chamada síncrona */
		rotacionando: 'Rotacionando…',
		/** Estado de sucesso */
		pronto: 'Pronto',
		/** Estado de erro */
		falhou: 'Falhou',
		/** Nome acessível do botão */
		ariaLabel: 'Executar a rotação',
		/** Linha de espera honesta durante a chamada */
		aguardando:
			'Chamada síncrona em andamento — pode levar de 15 a 40 segundos. ' +
			'A resposta chega de uma vez, com a imagem pronta.',
	},

	// ── resultado ────────────────────────────────────────────────
	resultado: {
		/** Título do cartão */
		titulo: 'Resultado',
		/** Cartão antes da primeira execução */
		vazio: 'O resultado aparece aqui, lado a lado com o original.',
		/** Legenda da imagem de entrada */
		original: 'Original',
		/** Legenda da imagem devolvida */
		rotacionada: 'Rotacionada',
		/** Rótulo da linha de uso retornado pela chamada */
		uso: 'Uso desta chamada',
		/** Selo quando a resposta veio do cache do servidor (sem usage) */
		doCache: 'veio do cache — nenhuma chamada foi feita',
		/** Selo curto de cache nas linhas do histórico */
		cacheSelo: 'cache',
		/** Rótulo do path gravado em disco */
		caminho: 'Gravado em',
		/** Nota de idempotência exibida no cartão de resultado */
		notaCache:
			'Repetir exatamente o mesmo input cai no cache do servidor: o PNG já gravado ' +
			'é devolvido sem novo gasto.',
	},

	// ── histórico da sessão ──────────────────────────────────────
	historico: {
		/** Título do cartão */
		titulo: 'Histórico da sessão',
		/** Lista vazia */
		vazio: 'Nenhuma execução ainda — o histórico some ao recarregar a página.',
	},

	// ── Sprite Studio (bancada create-character-v3) ──────────────
	studio: {
		/** Cabeçalho do painel da bancada */
		titulo: 'Sprite Studio — pose sul (v3)',
		/** Descrição sob o cabeçalho */
		descricao:
			'Bancada do create-character-v3: descreva o personagem, ajuste as configs e ' +
			'gere até 4 candidatos da pose sul em paralelo. Baixe o JSON e importe no ' +
			'Wizard para continuar nas 8 direções.',

		// toggle de seção do laboratório
		secoes: {
			/** Nome acessível do grupo */
			ariaLabel: 'Seção do laboratório',
			/** Opção: bancada v3 (default) */
			spriteSul: 'Sprite sul (v3)',
			/** Opção: playground do /rotate */
			rotacaoLivre: 'Rotação livre (/rotate)',
		},

		// formulário da bancada
		form: {
			/** Título do primeiro cartão (description/view/size/outputs) */
			cartaoPersonagem: 'Personagem',
			/** Título do cartão de qualidade (outline/detail/template/seeds) */
			cartaoQualidade: 'Qualidade',
			/** Textarea description */
			descricaoRotulo: 'Descrição (description)',
			/** Placeholder da description */
			descricaoPlaceholder: 'ex.: guerreiro de armadura enferrujada, capuz azul',
			/** Nota sob a description */
			descricaoNota: 'Obrigatória — é o único campo required do create-character-v3.',
			/** Select view */
			viewRotulo: 'View (view)',
			/** Nota sob a view */
			viewNota: 'Ângulo de câmera — low top-down é o padrão do projeto (ADR 0005).',
			/** Select image_size */
			tamanhoRotulo: 'Tamanho (image_size)',
			/** Nota sob o tamanho */
			tamanhoNota:
				'Faixa da v3: 32–256 px. Com imagem de referência o tamanho é advisory — ' +
				'o modelo decide o tamanho final do canvas.',
			/** Segmented outputs */
			saidasRotulo: 'Saídas em paralelo',
			/** Nome acessível do grupo de saídas */
			saidasAriaLabel: 'Número de saídas em paralelo',
			/** Nota sob as saídas */
			saidasNota:
				'Cada saída é uma geração cobrada: 4 saídas = 4 chamadas à v3 ' +
				'(o teto de 4 existe por causa do 429 "Concurrency limit" dela).',
			/** Input seed */
			seedRotulo: 'Seed',
			/** Placeholder da seed */
			seedPlaceholder: 'vazio = aleatório',
			/** Nota sob a seed */
			seedNota:
				'Base das seeds dos candidatos: preenchida, o candidato i recebe base + i; ' +
				'vazia, o servidor deriva a base do hash da config.',
			/** Checkbox no_background */
			semFundo: 'Sem fundo (no_background)',
			/** Nota do no_background */
			semFundoNota: 'Marcado por padrão — desmarcado, o fundo gerado permanece no sprite.',
			/** Checkbox enhance_prompt */
			melhorarPrompt: 'Melhorar prompt (enhance_prompt)',
			/** Nota do enhance_prompt */
			melhorarPromptNota:
				'O aprimoramento do prompt é cobrado à parte e o texto aprimorado volta na ' +
				'resposta (enhanced_prompt).',
			/** Select outline */
			outlineRotulo: 'Outline (outline)',
			/** Select detail */
			detailRotulo: 'Detail (detail)',
			/** Opção vazia das selects de qualidade */
			padraoApi: 'Padrão da API (não enviar)',
			/** Nota sob outline/detail */
			qualidadeNota:
				'A v3 IGNORA outline e detail quando há imagem de referência — eles só ' +
				'valem na geração do zero (from-scratch).',
			/** Select template_id */
			templateRotulo: 'Template (template_id)',
			/** Nota sob o template_id */
			templateNota:
				'Esqueleto 3D ajustado aos frames — precisa combinar com o corpo da ' +
				'referência (mannequin para bípedes).',
			/** Rótulo da dropzone de referência */
			referenciaRotulo: 'Imagem de referência (reference_image)',
			/** Dropzone de referência vazia */
			referenciaVazio: 'Opcional: arraste um PNG ou JPG, ou clique',
			/** Nota sob a dropzone de referência */
			referenciaNota:
				'Máximo 256×256 da v3 — imagens maiores são redimensionadas aqui no ' +
				'navegador, sem suavização, antes de qualquer envio.',
			/** Botão que remove a referência */
			referenciaRemover: 'Remover referência',
		},

		// botão de execução
		executar: {
			/** Estado inicial do multi-state-button */
			gerar: 'Gerar sprite sul',
			/** Estado durante o job */
			gerando: 'Gerando…',
			/** Estado de sucesso */
			pronto: 'Pronto',
			/** Estado de erro */
			falhou: 'Falhou',
			/** Nome acessível do botão */
			ariaLabel: 'Gerar a pose sul',
			/** Linha de espera honesta durante o job */
			aguardando:
				'Job assíncrono em andamento — a v3 costuma levar alguns minutos. ' +
				'O andamento aparece aqui quando o servidor responde.',
		},

		// resultado
		resultado: {
			/** Título do cartão */
			titulo: 'Candidatos',
			/** Cartão antes da primeira execução */
			vazio: 'Os candidatos da pose sul aparecem aqui — clique em um para selecionar.',
			/** Selo do candidato escolhido */
			selecionado: 'selecionado',
			/** Botão de download do bundle */
			baixarJson: 'Baixar JSON',
			/** Nota sob o botão de download */
			notaWizard:
				'Importe o JSON baixado no Wizard (aba Personagem) para gerar as 8 ' +
				'direções a partir da pose escolhida.',
			/** Selo quando a resposta veio do cache do servidor */
			doCache: 'veio do cache — nenhuma chamada foi feita',
		},

		// erros de validação local (antes de chamar o servidor)
		erros: {
			/** description vazia */
			descricaoObrigatoria: 'Descreva o personagem antes de gerar.',
			/** view fora do enum (não acontece pela tela) */
			viewInvalida: 'View inválida — o spec aceita: low top-down, high top-down, side.',
			/** size fora dos presets */
			tamanhoInvalido: 'Tamanho fora da faixa da v3: escolha um preset entre 32 e 256 px.',
			/** seed preenchida com valor não inteiro */
			seedInvalida: 'Seed deve ser um número inteiro — ou deixe vazio para aleatório.',
			/** outputs fora de 1–4 (não acontece pela tela) */
			saidasInvalidas: 'Saídas em paralelo devem ser um inteiro entre 1 e 4.',
			/** job falhou no servidor sem mensagem */
			jobFalhou: 'O job falhou no servidor.',
		},
	},

	// ── erros de validação local (antes de chamar o servidor) ────
	erros: {
		/** Execução sem imagem carregada */
		imagemObrigatoria: 'Envie uma imagem para rotacionar.',
		/** imageSize fora de 16–200 ou não inteiro */
		tamanhoForaDaFaixa:
			'imageSize fora da faixa do /rotate: largura e altura devem ser inteiros entre 16 e 200.',
		/** directionChange fora de -180..180 ou não inteiro */
		giroForaDaFaixa: 'directionChange deve ser um inteiro entre -180 e 180.',
		/** viewChange fora de -90..90 ou não inteiro */
		inclinacaoForaDaFaixa: 'viewChange deve ser um inteiro entre -90 e 90.',
		/** seed preenchida com valor não inteiro */
		seedInvalida: 'Seed deve ser um número inteiro — ou deixe vazio para aleatório.',
	},

	/** Rótulos pt-BR das oito direções (chave = valor do enum Direction) */
	directions: {
		north: 'norte',
		'north-east': 'nordeste',
		east: 'leste',
		'south-east': 'sudeste',
		south: 'sul',
		'south-west': 'sudoeste',
		west: 'oeste',
		'north-west': 'noroeste',
	},
} as const;

// ==================================================================
// Parameterised strings (funções com nomes descritivos)
// ==================================================================

/** "S → E · side → low top-down" — resumo de uma execução por direção */
export const resumoDirecoes = (
	fromShort: string,
	toShort: string,
	fromView: string,
	toView: string,
): string => `${fromShort} → ${toShort} · ${fromView} → ${toView}`;

/** "giro de 90° · inclinação de 0°" — resumo de uma execução por ângulos */
export const resumoAngulos = (
	directionChange: number,
	viewChange: number,
): string => `giro de ${directionChange}° · inclinação de ${viewChange}°`;

/** "US$ 0.0106" — valor em dólar retornado no usage da chamada */
export const usoUsd = (usd: number): string => `US$ ${usd.toFixed(4)}`;

/** "1 geração(ões)" — contagem de gerações retornada no usage da chamada */
export const usoGeracoes = (n: number): string => `${n} geração(ões)`;

/** "64×64 px detectados" — dimensões lidas da imagem carregada */
export const dimensoesDetectadas = (width: number, height: number): string =>
	`${width}×${height} px detectados`;

/** "imagem ajustada de 512×512 para 256×256 — limite da v3" — aviso do auto-resize da referência */
export const imagemAjustadaReferencia = (
	fromWidth: number,
	fromHeight: number,
	toWidth: number,
	toHeight: number,
): string =>
	`imagem ajustada de ${fromWidth}×${fromHeight} para ${toWidth}×${toHeight} — limite da v3`;

/** "128 px · low top-down · 2 saídas" — resumo de uma execução da bancada */
export const resumoStudio = (size: number, view: string, outputs: number): string =>
	`${size} px · ${view} · ${outputs} ${outputs === 1 ? 'saída' : 'saídas'}`;

/** "#1 · seed 701" — legenda de um candidato na grade */
export const rotuloCandidato = (index: number, seed: number): string =>
	`#${index} · seed ${seed}`;

/** "sprite-lab-south-<hash>.json" — nome do arquivo do bundle baixado */
export const nomeArquivoSpriteLab = (hash: string): string =>
	`sprite-lab-south-${hash}.json`;
