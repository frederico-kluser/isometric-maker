/**
 * Bússola do viewport — canto superior direito do editor.
 *
 * Indica para qual direção do mundo a câmera está olhando (N, S, L, O): a rosa
 * dos ventos fica FIXA e a agulha gira, apontando para o rótulo da vista atual.
 * A agulha acompanha o giro suave da câmera mesmo que o React só receba o
 * estado final da rotação (o giro de 280 ms roda no ticker do PixiJS).
 *
 * ## Por que duas camadas SVG (fixa + agulha)
 *
 * CSS `transform-origin` em elementos `<g>` do SVG tem comportamento
 * inconsistente entre navegadores: `transform-box: view-box` não é suportado
 * universalmente, e sem ele `50% 50%` cai no bounding box do `<g>` (que é
 * a agulha alongada, ~8×52) — o centro da rotação sai do centro da rosa e
 * a agulha "orbita" em vez de girar no lugar.
 *
 * A solução: a agulha vive num `<div>` HTML (não SVG) absolutamente
 * posicionado sobre a rosa fixa. `<div>` recebe `transform: rotate()` com
 * `transform-origin: center`, que funciona em qualquer navegador.
 *
 * ## Por que ângulo acumulado, e não `(2 - rotation) * 90`
 *
 * O ângulo alvo é `(2 - rotation) * 90`: rotação 0 (Sul) = agulha para baixo,
 * 1 (Oeste) = direita, 2 (Norte) = cima, 3 (Leste) = esquerda. Mas aplicar o
 * alvo direto quebraria o caminho curto: de 270° para 0°, o CSS animaria 270°
 * no sentido errado em vez de 90° no certo.
 *
 * Então o ângulo acumula voltas completas — nunca é normalizado para 0–360.
 * Cada mudança soma `-shortestTurn(anterior, atual) * 90`: o sinal é invertido
 * porque a agulha gira JUNTO com o mapa na tela (quando o `turn` da câmera
 * cresce, o mapa gira anti-horário na tela — e a agulha de 270° para 180°
 * também). A meia-volta herda o desempate do `shortestTurn`: horário.
 *
 * ## Por que CSS transition em vez de JS de animação
 *
 * O React não re-renderiza durante o giro, então uma transição CSS de
 * `transform` com a MESMA duração e curva da câmera anima a agulha no mesmo
 * intervalo. A curva é `cubic-bezier(0.65, 0, 0.35, 1)`, a aproximação
 * cubic-bezier do `easeInOutCubic` — verificada numericamente: a alternativa
 * `cubic-bezier(0.4, 0, 0.6, 1)` fica ~6 pontos percentuais longe no segundo
 * tempo, e o `ease-in-out` padrão do CSS (~0,42/0,58) ~5.
 */
import { useEffect, useRef, useState } from 'react';
import { ROTATION_LABELS, type Rotation } from '../../../../../packages/iso-core/src/rotation.ts';
import {
  ROTATION_DURATION_MS,
  shortestTurn,
} from '../../../../../packages/iso-core/src/rotation-tween.ts';
import { editor as T } from '../strings.ts';

/** Aproximação cubic-bezier do `easeInOutCubic` do giro da câmera. */
const COMPASS_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

export function Compass({ rotation }: { rotation: Rotation }) {
  const [needleAngle, setNeedleAngle] = useState<number>((2 - rotation) * 90);
  const prevRotationRef = useRef<Rotation>(rotation);

  useEffect(() => {
    const prev = prevRotationRef.current;
    if (prev === rotation) return;
    prevRotationRef.current = rotation;
    setNeedleAngle((angle) => angle - shortestTurn(prev, rotation) * 90);
  }, [rotation]);

  const vista = ROTATION_LABELS[rotation];

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 rounded-full border border-border bg-card/85 p-1.5 backdrop-blur"
      role="img"
      aria-label={T.bussola.ariaLabel(vista)}
      title={T.bussola.titulo(vista)}
    >
      <div className="relative size-16">
        {/* Rosa dos ventos FIXA: círculo e rótulos N/S/L/O. */}
        <svg
          viewBox="-50 -50 100 100"
          className="absolute inset-0 size-full text-foreground"
        >
          <circle r="30" fill="none" strokeWidth="2" className="stroke-foreground/25" />
          <g
            className="fill-muted-foreground"
            fontSize="16"
            fontWeight="600"
            textAnchor="middle"
            dominantBaseline="central"
          >
            <text y="-38">N</text>
            <text y="38">S</text>
            <text x="-38">O</text>
            <text x="38">L</text>
          </g>
        </svg>

        {/* Agulha: camada HTML sobreposta. O `<div>` gira com CSS
            transition — `transform-origin: center` funciona em HTML,
            não tem os problemas de SVG `transform-box`. */}
        <div
          className="absolute inset-0"
          style={{
            transform: `rotate(${needleAngle}deg)`,
            transition: `transform ${ROTATION_DURATION_MS}ms ${COMPASS_EASE}`,
          }}
        >
          <svg viewBox="-50 -50 100 100" className="size-full" overflow="visible">
            <polygon points="0,-26 4,0 0,0 -4,0" className="fill-foreground" />
            <polygon points="0,0 4,0 0,26 -4,0" className="fill-foreground/35" />
            <circle r="3.5" className="fill-background stroke-foreground/50" strokeWidth="1.5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
