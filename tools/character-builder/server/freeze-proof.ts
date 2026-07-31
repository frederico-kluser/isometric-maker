/**
 * Prova de congelamento das cardeais enviadas no mapa `directions`.
 *
 * Extraído de server/api.ts sem mudança de lógica (fase 2 do wizard v2):
 * decodePNGPixels, pixelsIdenticos e verifyFreezing viviam como cópias
 * privadas lá; aqui viram módulo importável. A fase 3 troca as cópias
 * privadas de api.ts por import deste arquivo.
 *
 * A prova verifica que o parâmetro `directions` de
 * /create-character-with-8-directions congela as direções fornecidas em vez
 * de regenerá-las — comparando os PIXELS decodificados, não os bytes:
 * reencodar um PNG muda os bytes e não muda a imagem.
 */
import { inflateSync } from "node:zlib";

/**
 * Decodifica os pixels de um PNG 8 bpc RGB/RGBA usando só node:zlib.
 * Retorna null se o PNG não estiver num formato suportado.
 */
export function decodePNGPixels(
	b64: string,
): { width: number; height: number; pixels: Buffer } | null {
	const buf = Buffer.from(b64, "base64");
	if (buf.length < 8) return null;
	// Assinatura PNG
	const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
	for (let i = 0; i < 8; i += 1) if (buf[i] !== SIG[i]) return null;

	let pos = 8;
	let width = 0,
		height = 0,
		bitDepth = 0,
		colorType = 0;
	const idatChunks: Buffer[] = [];

	while (pos + 12 <= buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);

		if (type === "IHDR") {
			width = buf.readUInt32BE(pos + 8);
			height = buf.readUInt32BE(pos + 12);
			bitDepth = buf[pos + 16]!;
			colorType = buf[pos + 17]!;
		} else if (type === "IDAT") {
			idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
		} else if (type === "IEND") {
			break;
		}
		pos += 12 + len;
	}

	if (idatChunks.length === 0 || width === 0 || height === 0) return null;
	if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;

	const channels = colorType === 6 ? 4 : 3;
	const raw = inflateSync(Buffer.concat(idatChunks));
	const stride = 1 + width * channels; // 1 filter byte + scanline
	const pixels = Buffer.alloc(width * height * channels);

	// Desfiltra cada scanline (None, Sub, Up, Average, Paeth).
	for (let y = 0; y < height; y += 1) {
		const row = raw.subarray(y * stride, (y + 1) * stride);
		const filter = row[0]!;
		const scanline = row.subarray(1);
		const outRow = pixels.subarray(
			y * width * channels,
			(y + 1) * width * channels,
		);

		for (let x = 0; x < scanline.length; x += 1) {
			const left = x >= channels ? outRow[x - channels]! : 0;
			const up = y > 0 ? pixels[(y - 1) * width * channels + x]! : 0;
			const upLeft =
				y > 0 && x >= channels
					? pixels[(y - 1) * width * channels + x - channels]!
					: 0;

			let val = scanline[x]!;
			switch (filter) {
				case 0:
					break; // None
				case 1:
					val = (val + left) & 0xff;
					break; // Sub
				case 2:
					val = (val + up) & 0xff;
					break; // Up
				case 3:
					val = (val + ((left + up) >> 1)) & 0xff;
					break; // Average
				case 4: {
					// Paeth
					const p = left + up - upLeft;
					const pL = Math.abs(p - left);
					const pU = Math.abs(p - up);
					const pUL = Math.abs(p - upLeft);
					const pr = pL <= pU && pL <= pUL ? left : pU <= pUL ? up : upLeft;
					val = (val + pr) & 0xff;
					break;
				}
				default:
					return null; // filtro desconhecido
			}
			outRow[x] = val;
		}
	}

	return { width, height, pixels };
}

/**
 * Compara os pixels decodificados de duas imagens PNG.
 * Retorna true se forem idênticos, false se diferirem, e null se a decodificação
 * falhar (formato não suportado).
 */
export function pixelsIdenticos(
	sentB64: string,
	returnedB64: string,
): boolean | null {
	// Atalho: buffers idênticos = congelamento byte-a-byte confirmado.
	if (
		Buffer.from(sentB64, "base64").equals(Buffer.from(returnedB64, "base64"))
	) {
		return true;
	}
	// Comparação pixel a pixel para o caso de recompressão sem alteração.
	const sent = decodePNGPixels(sentB64);
	const returned = decodePNGPixels(returnedB64);
	if (!sent || !returned) return null;
	if (sent.width !== returned.width || sent.height !== returned.height)
		return false;
	return sent.pixels.equals(returned.pixels);
}

/**
 * Verifica que as 4 cardeais devolvidas pela API têm os mesmos pixels das
 * imagens enviadas no mapa `directions`. Esta é a prova de que o parâmetro
 * `directions` de /create-character-with-8-directions congela as direções
 * fornecidas em vez de regenerá-las.
 */
export async function verifyFreezing(
	sent: Record<string, string>,
	response: unknown,
	imageSize: number,
): Promise<void> {
  // O endpoint devolve um dicionário keyeado por nome de direção.
  // Prefer storage_urls (downloadable PNGs) over raw response values.
  const returned = (response as Record<string, unknown> | null) ?? {};
  const storageUrls = returned['storage_urls'] as Record<string, string> | undefined;
  const images = returned['images'];
  const rawDict = (images && typeof images === 'object' ? images : returned) as Record<string, unknown>;

	const cardinals = ["south", "north", "east", "west"] as const;
	const results: string[] = [];

	for (const dir of cardinals) {
		const sentB64 = sent[dir];
		if (!sentB64) {
			results.push(`${dir}: ausente do mapa enviado — pulando`);
			continue;
		}

		let returnedB64: string | undefined;
		// Try storage_urls first (downloadable PNG)
		const storageUrl = storageUrls?.[dir];
		if (storageUrl) {
			try {
				const dl = await fetch(storageUrl);
				if (dl.ok) {
					returnedB64 = Buffer.from(await dl.arrayBuffer()).toString('base64');
				}
			} catch { /* fall through to raw dict */ }
		}
		// Fallback: extract from raw response
		if (!returnedB64) {
			const val = rawDict[dir];
			if (typeof val === 'string') {
				returnedB64 = val.replace(/^data:image\/\w+;base64,/, '');
			} else if (val && typeof val === 'object' && 'base64' in val) {
				returnedB64 = (val as Record<string, unknown>)['base64'] as string | undefined;
			}
		}
		if (!returnedB64) {
			results.push(`${dir}: resposta não contém base64 para esta direção`);
			continue;
		}

		const identical = pixelsIdenticos(sentB64, returnedB64);
		if (identical === true) {
			results.push(`${dir}: CONGELADA — pixels idênticos`);
		} else if (identical === false) {
			const sDec = decodePNGPixels(sentB64);
			const rDec = decodePNGPixels(returnedB64);
			const sInfo = sDec ? `${sDec.width}×${sDec.height}` : "?";
			const rInfo = rDec ? `${rDec.width}×${rDec.height}` : "?";
			// Canvas inflation (API enlarges by ~40%): check if the inner region matches.
			if (sDec && rDec && rDec.width >= sDec.width && rDec.height >= sDec.height) {
				const channels = sDec.pixels.length / (sDec.width * sDec.height);
				const rChannels = rDec.pixels.length / (rDec.width * rDec.height);
				if (channels === rChannels) {
					let match = true;
					const sentRowBytes = sDec.width * channels;
					const retRowBytes = rDec.width * channels;
					for (let y = 0; y < sDec.height && match; y++) {
						const sOff = y * sentRowBytes;
						const rOff = y * retRowBytes;
						match = sDec.pixels.subarray(sOff, sOff + sentRowBytes).equals(
							rDec.pixels.subarray(rOff, rOff + sentRowBytes)
						);
					}
					if (match) {
						results.push(`${dir}: CONGELADA — pixels idênticos (canvas inflado ${sInfo}→${rInfo})`);
						continue;
					}
				}
			}
			results.push(
				`${dir}: REPROCESSADA — sent ${sInfo}, returned ${rInfo}. ` +
					`O mapa directions não congelou esta direção.`,
			);
		} else {
			results.push(
				`${dir}: não foi possível decodificar — verificação inconclusiva`,
			);
		}
	}

	console.log(`[freeze] Prova de congelamento (image_size=${imageSize}):`);
	for (const r of results) console.log(`[freeze]   ${r}`);
}
