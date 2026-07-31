#!/usr/bin/env node

// scripts/validate-ledger.mjs — validador do ledger de incerteza.
// Chamado pelo gate.sh. Confere que cada item do ledger está bem formado.

import { readFileSync } from 'node:fs';

const LEDGER_PATH = 'docs/plano/ledger.json';

const BLACKLIST = ['ok', 'confirmado', 'conforme combinado', 'ok!', 'feito', 'resolvido'];

function isVerifiable(evidencia) {
  const s = evidencia.toString().trim();
  // arquivo:linha — ex: tools/pixellab-pipeline/src/cost.ts:42
  if (/^[^\s:]+\.[a-z]+:\d+$/.test(s)) return true;
  // saída de comando:
  if (/^saída de comando:/.test(s)) return true;
  // ADR NNNN
  if (/^ADR \d{4}/.test(s)) return true;
  // resposta de NOME em DATA
  if (/^resposta de .+ em \d{4}-\d{2}-\d{2}/.test(s)) return true;
  return false;
}

function validateLedger() {
  let ledger;
  try {
    const raw = readFileSync(LEDGER_PATH, 'utf-8');
    ledger = JSON.parse(raw);
  } catch (err) {
    console.error(`ERRO: não foi possível ler ${LEDGER_PATH}: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(ledger)) {
    console.error('ERRO: ledger.json não é um array');
    process.exit(1);
  }

  let errors = 0;

  for (const item of ledger) {
    const id = item.id || '(sem id)';

    if (!item.evidencia || item.evidencia.toString().trim() === '') {
      // Item ABERTO
      if (!item.por_que_aberto || item.por_que_aberto.toString().trim() === '') {
        console.error(`ERRO: item ${id}: por_que_aberto vazio`);
        errors++;
      }
      if (!item.decisao_provisoria || item.decisao_provisoria.toString().trim() === '') {
        console.error(`ERRO: item ${id}: decisao_provisoria vazia`);
        errors++;
      }
      if (!item.verificacao || item.verificacao.toString().trim() === '') {
        console.error(`ERRO: item ${id}: verificacao vazia`);
        errors++;
      }
    } else {
      // Item FECHADO
      if (!item.data_resolucao) {
        console.error(`ERRO: item ${id}: fechado sem data_resolucao`);
        errors++;
      }
      const ev = item.evidencia.toString().toLowerCase().trim();
      if (BLACKLIST.includes(ev)) {
        console.error(`ERRO: item ${id}: evidencia na lista negra — "${item.evidencia}"`);
        errors++;
      }
      if (!isVerifiable(ev)) {
        console.error(
          `ERRO: item ${id}: evidencia não casa com formato verificável — ` +
          `use arquivo:linha, "saída de comando:", "ADR NNNN" ou "resposta de NOME em DATA"`
        );
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.error(`${errors} erro(s) no ledger`);
    process.exit(1);
  }

  console.log(`ledger OK (${ledger.length} itens)`);
}

validateLedger();
