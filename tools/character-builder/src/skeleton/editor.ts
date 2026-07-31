/**
 * Editor visual de esqueleto — F1-05.
 *
 * Permite arrastar 18 keypoints num canvas, ajustar a altura com um slider,
 * reescalar os keypoints e aprovar o resultado.
 *
 * ## Regras
 *
 * - ZERO chamadas de rede.  Tudo local.
 * - Escala UNIFORME apenas — sem deformação não-uniforme.
 * - Animação NUNCA é destravada sem aprovação explícita.
 * - O estado `aprovado` é um booleano explícito, não um efeito colateral.
 *
 * ## Uso
 *
 * ```ts
 * const editor = createSkeletonEditor(container, {
 *   keypoints: [...],
 *   alturaPx: 64,
 *   alturaCanonica: 64,
 * });
 *
 * // Mais tarde:
 * if (editor.aprovado) {
 *   const keypoints = editor.keypoints;
 * }
 * ```
 */

import { rescale, type Keypoint2D } from './affine.ts';
import { SKELETON_LABELS } from '../../server/model.ts';

// ------------------------------------------------------------------ tipos

export interface SkeletonEditorConfig {
  /** Keypoints iniciais (18, um por SKELETON_LABEL). */
  readonly keypoints: readonly Keypoint2D[];
  /** Altura actual em píxeis. */
  readonly alturaPx: number;
  /** Altura canónica (a que os keypoints foram desenhados). */
  readonly alturaCanonica: number;
}

export interface SkeletonEditor {
  /** Keypoints actuais (após arrastos e reescalamentos). */
  readonly keypoints: readonly Keypoint2D[];
  /** true se o utilizador aprovou explicitamente. */
  readonly aprovado: boolean;
  /** Altura actual em píxeis. */
  readonly alturaPx: number;
  /** Remove o editor do DOM e liberta listeners. */
  destroy(): void;
}

// ------------------------------------------------------------------ constantes

const POINT_RADIUS = 6;
const POINT_COLOR = '#e74c3c';
const POINT_COLOR_DRAG = '#c0392b';
const LINE_COLOR = '#3498db';
const LINE_WIDTH = 2;
const CANVAS_BG = '#1a1a2e';

/** Conexões entre keypoints para desenhar o esqueleto (ossos). */
const BONES: readonly (readonly [string, string])[] = [
  ['NOSE', 'NECK'],
  ['NECK', 'RIGHT SHOULDER'],
  ['NECK', 'LEFT SHOULDER'],
  ['RIGHT SHOULDER', 'RIGHT ELBOW'],
  ['RIGHT ELBOW', 'RIGHT ARM'],
  ['LEFT SHOULDER', 'LEFT ELBOW'],
  ['LEFT ELBOW', 'LEFT ARM'],
  ['NECK', 'RIGHT HIP'],
  ['NECK', 'LEFT HIP'],
  ['RIGHT HIP', 'RIGHT KNEE'],
  ['RIGHT KNEE', 'RIGHT LEG'],
  ['LEFT HIP', 'LEFT KNEE'],
  ['LEFT KNEE', 'LEFT LEG'],
  ['NOSE', 'RIGHT EYE'],
  ['NOSE', 'LEFT EYE'],
  ['RIGHT EYE', 'RIGHT EAR'],
  ['LEFT EYE', 'LEFT EAR'],
];

// ------------------------------------------------------------------ factory

export function createSkeletonEditor(
  container: HTMLElement,
  config: SkeletonEditorConfig,
): SkeletonEditor {
  // --- estado interno ---
  let keypoints: Keypoint2D[] = config.keypoints.map((kp) => ({ ...kp }));
  let alturaPx = config.alturaPx;
  const alturaCanonica = config.alturaCanonica;
  let aprovado = false;

  // --- elementos DOM ---
  const wrapper = document.createElement('div');
  wrapper.className = 'skeleton-editor';

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  canvas.style.border = '1px solid #333';
  canvas.style.borderRadius = '4px';
  canvas.style.cursor = 'crosshair';

  const ctx = canvas.getContext('2d')!;

  // Controls
  const controls = document.createElement('div');
  controls.style.marginTop = '8px';
  controls.style.display = 'flex';
  controls.style.gap = '8px';
  controls.style.alignItems = 'center';
  controls.style.flexWrap = 'wrap';

  // Slider de altura
  const heightLabel = document.createElement('label');
  heightLabel.textContent = 'Altura: ';
  heightLabel.style.color = '#ccc';
  heightLabel.style.fontSize = '14px';

  const heightSlider = document.createElement('input');
  heightSlider.type = 'range';
  heightSlider.min = '32';
  heightSlider.max = '256';
  heightSlider.value = String(alturaPx);
  heightSlider.style.width = '150px';

  const heightValue = document.createElement('span');
  heightValue.textContent = `${alturaPx}px`;
  heightValue.style.color = '#ccc';
  heightValue.style.fontSize = '14px';
  heightValue.style.minWidth = '50px';

  // Botão Reescalar
  const rescaleBtn = document.createElement('button');
  rescaleBtn.textContent = 'Reescalar';
  rescaleBtn.style.padding = '4px 12px';

  // Botão Aprovar
  const approveBtn = document.createElement('button');
  approveBtn.textContent = 'Aprovar';
  approveBtn.style.padding = '4px 12px';
  approveBtn.style.fontWeight = 'bold';

  // Indicador de estado
  const statusEl = document.createElement('span');
  statusEl.style.fontSize = '14px';
  statusEl.style.marginLeft = '8px';

  const updateStatus = (): void => {
    if (aprovado) {
      statusEl.textContent = '✓ Aprovado';
      statusEl.style.color = '#2ecc71';
      approveBtn.textContent = 'Revogar';
      approveBtn.style.background = '#2ecc71';
      approveBtn.style.color = '#000';
    } else {
      statusEl.textContent = '✗ Pendente';
      statusEl.style.color = '#e74c3c';
      approveBtn.textContent = 'Aprovar';
      approveBtn.style.background = '';
      approveBtn.style.color = '';
    }
  };

  controls.append(
    heightLabel,
    heightSlider,
    heightValue,
    rescaleBtn,
    approveBtn,
    statusEl,
  );

  wrapper.append(canvas, controls);
  container.append(wrapper);

  updateStatus();

  // --- desenho ---

  function draw(): void {
    const w = canvas.width;
    const h = canvas.height;

    // Fundo
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, w, h);

    // Grelha
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    const gridSize = 32;
    for (let x = gridSize; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = gridSize; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Linhas dos ossos
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';

    const index = new Map<string, Keypoint2D>();
    for (const kp of keypoints) {
      index.set(kp.label, kp);
    }

    for (const [a, b] of BONES) {
      const ka = index.get(a);
      const kb = index.get(b);
      if (!ka || !kb) continue;

      ctx.beginPath();
      ctx.moveTo(ka.x, ka.y);
      ctx.lineTo(kb.x, kb.y);
      ctx.stroke();
    }

    // Pontos (keypoints)
    for (const kp of keypoints) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = POINT_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // --- interacção de arrasto ---

  let dragging: string | null = null; // label do keypoint a ser arrastado

  function hitTest(mx: number, my: number): string | null {
    // Procura do topo para baixo (último desenhado primeiro)
    for (let i = keypoints.length - 1; i >= 0; i--) {
      const kp = keypoints[i]!;
      const dx = mx - kp.x;
      const dy = my - kp.y;
      if (dx * dx + dy * dy <= POINT_RADIUS * POINT_RADIUS + 4) {
        return kp.label;
      }
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e) => {
    if (aprovado) return; // não editar após aprovação
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) {
      dragging = hit;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragging) {
      // Move o keypoint
      keypoints = keypoints.map((kp) =>
        kp.label === dragging ? { ...kp, x: mx, y: my } : kp,
      );
      draw();
    } else if (!aprovado) {
      const hit = hitTest(mx, my);
      canvas.style.cursor = hit ? 'grab' : 'crosshair';
    }
  });

  canvas.addEventListener('mouseup', () => {
    dragging = null;
    canvas.style.cursor = aprovado ? 'default' : 'crosshair';
  });

  canvas.addEventListener('mouseleave', () => {
    dragging = null;
    canvas.style.cursor = aprovado ? 'default' : 'crosshair';
  });

  // --- botões ---

  heightSlider.addEventListener('input', () => {
    alturaPx = Number(heightSlider.value);
    heightValue.textContent = `${alturaPx}px`;
  });

  rescaleBtn.addEventListener('click', () => {
    if (aprovado) return;
    keypoints = rescale(keypoints, alturaPx, alturaCanonica);
    draw();
  });

  approveBtn.addEventListener('click', () => {
    aprovado = !aprovado;
    updateStatus();
    canvas.style.cursor = aprovado ? 'default' : 'crosshair';
    draw();
  });

  // --- desenho inicial ---
  draw();

  // --- API pública ---

  return {
    get keypoints(): readonly Keypoint2D[] {
      return keypoints;
    },
    get aprovado(): boolean {
      return aprovado;
    },
    get alturaPx(): number {
      return alturaPx;
    },
    destroy(): void {
      wrapper.remove();
    },
  };
}
