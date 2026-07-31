/**
 * Strings da aba Laboratório — playground livre do endpoint /rotate.
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
