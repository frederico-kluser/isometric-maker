/**
 * Diálogo de custo — exibido antes de cada geração.
 *
 * Mostra:
 *   - Quantas gerações serão executadas
 *   - Estimativa de custo (USD)
 *   - Total gasto na sessão actual
 *   - Total gasto no mês
 *
 * O botão Confirmar começa DESABILITADO por um instante (2 segundos) quando o
 * guard exige confirmação — evita clique impulsivo.
 *
 * Quando nada há para gerar:
 *   "0 de N a gerar · N em cache · US$ 0,00" — COM denominador.
 */
import { S } from './strings.ts';
import type { EstimateResponse } from '../server/estimate.ts';

// ------------------------------------------------------------------ tipos

export type CostDialogResult =
  | { confirmed: true }
  | { confirmed: false; reason: 'cancel' | 'close' };

// ------------------------------------------------------------------ helpers

function fmtUsd(usd: number): string {
  return `US$ ${usd.toFixed(2)}`;
}

// ------------------------------------------------------------------ diálogo

/**
 * Mostra o diálogo de custo e devolve uma Promise que resolve quando o
 * utilizador confirma ou cancela.
 *
 * @param estimate — Resposta do endpoint /api/estimate.
 * @param totalItems — Quantos itens há para gerar no total (denominador).
 * @param cachedCount — Quantos já estão em cache.
 */
export function showCostDialog(
  estimate: EstimateResponse,
  totalItems: number,
  cachedCount: number,
): Promise<CostDialogResult> {
  return new Promise((resolve) => {
    // --- overlay ---
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog cost-dialog';

    // --- conteúdo ---
    const { report, generations } = estimate;
    const e = report.estimate;

    const pending = totalItems - cachedCount;

    const html = `
      <h3>Custo estimado</h3>

      <div class="cost-grid">
        <div class="cost-row">
          <span class="cost-label">A gerar</span>
          <span class="cost-value">${pending} de ${totalItems}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Em cache</span>
          <span class="cost-value">${cachedCount}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Gerações</span>
          <span class="cost-value">~${generations}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Estimativa</span>
          <span class="cost-value">${fmtUsd(e.point)} (faixa ${fmtUsd(e.low)}–${fmtUsd(e.high)})</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Gasto na sessão</span>
          <span class="cost-value">${fmtUsd(report.sessionSpentUsd)}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Gasto no mês</span>
          <span class="cost-value">${fmtUsd(report.monthSpentUsd)}</span>
        </div>
      </div>

      ${report.avisos.length > 0 ? `
        <div class="cost-warnings">
          ${report.avisos.map((a) => `<p class="warning">⚠ ${a.text}</p>`).join('')}
        </div>
      ` : ''}

      <div class="dialog-actions">
        <button class="btn-cancel" id="cost-cancel">Cancelar</button>
        <button class="btn-confirm primary" id="cost-confirm">Confirmar</button>
      </div>
    `;

    dialog.innerHTML = html;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // --- handlers ---
    const confirmBtn = dialog.querySelector('#cost-confirm') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('#cost-cancel') as HTMLButtonElement;

    const cleanup = (): void => {
      overlay.remove();
    };

    cancelBtn.onclick = (): void => {
      cleanup();
      resolve({ confirmed: false, reason: 'cancel' });
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve({ confirmed: false, reason: 'close' });
      }
    });

    // Se o guard exige confirmação, o botão Confirmar começa DESABILITADO por
    // um instante (2 segundos) — evita clique impulsivo sem ler os avisos.
    if (report.requiresConfirmation) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Aguarde…';

      const enableAfter = 2000; // ms
      const startedAt = Date.now();

      const tick = (): void => {
        const remaining = Math.max(0, enableAfter - (Date.now() - startedAt));
        if (remaining > 0) {
          confirmBtn.textContent = `Confirmar (${Math.ceil(remaining / 1000)}s)`;
          requestAnimationFrame(tick);
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirmar';
        }
      };
      requestAnimationFrame(tick);
    }

    confirmBtn.onclick = (): void => {
      cleanup();
      resolve({ confirmed: true });
    };
  });
}
