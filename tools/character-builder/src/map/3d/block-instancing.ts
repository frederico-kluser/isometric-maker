/**
 * Renderizador de blocos com THREE.InstancedMesh — um draw call por tipo de bloco.
 *
 * Cada blockId ganha UM `InstancedMesh` que desenha todas as células daquele tipo
 * num único draw call. A malha de cubos individuais que existia em `syncBlocks`
 * (um `THREE.Mesh` por célula) some, e com ela centenas de draw calls redundantes.
 *
 * ## Células escondidas (hidden cell culling)
 *
 * Uma célula completamente cercada nos 6 lados por vizinhos opacos não é
 * instanciada — ela nunca seria visível. A pré-passagem `computeHiddenCells`
 * calcula isso antes da criação das instâncias.
 *
 * ## Sombra entre cubos
 *
 * O `InstancedMesh` principal projeta sombra (`castShadow`). Para a sombra ENTRE
 * cubos empilhados (que exige `receiveShadow`), quadrados `ShadowMaterial` são
 * mantidos num grupo separado, não-instanced — um por célula visível. Geometria e
 * material são compartilhados (herdados de `cube3d.ts`).
 *
 * ## Slots e lista livre
 *
 * As instâncias são alocadas num array esparso. Slots liberados vão para uma
 * lista livre e são reutilizados. Slots livres ganham matriz de escala zero para
 * não aparecerem. O `count` do InstancedMesh é o maior índice ocupado + 1.
 */
import * as THREE from 'three';
import { createCubeShadowQuad, SHADOW_QUAD_EPS, type CubeArt } from './cube3d.ts';

// ------------------------------------------------------------------ constantes

/** Capacidade inicial de instâncias por tipo de bloco. Dobra quando esgota. */
const INITIAL_CAPACITY = 1024;

/** Posição do centro do cubo unitário (BoxGeometry 1×1×1 centrado na origem). */
const HALF_CUBE = 0.5;

// ------------------------------------------------------------------ tipos

/** Dados de uma célula instanciada — o que o raycaster precisa. */
export interface CellData {
  readonly blockId: string;
  /** Coordenadas do mapa: x (leste), y (norte), z (altura). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Estado de uma instância individual. */
interface InstanceEntry {
  cell: CellData;
  /** Quad de sombra não-instanced para oclusão entre cubos. */
  shadowQuad: THREE.Mesh;
}

/** Estado de um bloco (um InstancedMesh + bookkeeping). */
interface BlockState {
  mesh: THREE.InstancedMesh;
  /** Array esparso: entradas nos índices ocupados, undefined nos livres. */
  entries: (InstanceEntry | undefined)[];
  /** Índices disponíveis para reúso. */
  freeList: number[];
  /** Maior índice ocupado + 1 (ou 0 se vazio). */
  count: number;
  /** Capacidade alocada (entries.length). */
  capacity: number;
}

// ------------------------------------------------------------------ célula escondida

/**
 * Conjunto de chaves "x:z:y" de células que NÃO devem ser instanciadas porque
 * estão completamente cercadas nos 6 lados por vizinhos opacos.
 *
 * Percorre o mapa uma vez, monta o conjunto de células ocupadas, e então marca
 * como escondida toda célula cujos 6 vizinhos também estejam ocupados.
 */
export function computeHiddenCells(
  blocks: Record<string, readonly { block: string; count: number }[]>,
): Set<string> {
  // Primeiro passe: conjunto de todas as células ocupadas.
  const occupied = new Set<string>();
  for (const [colKey, runs] of Object.entries(blocks)) {
    const [xs, ys] = colKey.split(':');
    const cx = Number(xs);
    const cy = Number(ys);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    let height = 0;
    for (const run of runs) {
      if (run.block !== '') {
        for (let i = 0; i < run.count; i += 1) {
          occupied.add(`${cx}:${cy}:${height + i}`);
        }
      }
      height += run.count;
    }
  }

  // Segundo passe: uma célula está escondida se todos os 6 vizinhos estão ocupados.
  const hidden = new Set<string>();
  for (const key of occupied) {
    const [xs, ys, zs] = key.split(':');
    const cx = Number(xs);
    const cy = Number(ys);
    const cz = Number(zs);
    if (
      occupied.has(`${cx + 1}:${cy}:${cz}`) &&
      occupied.has(`${cx - 1}:${cy}:${cz}`) &&
      occupied.has(`${cx}:${cy + 1}:${cz}`) &&
      occupied.has(`${cx}:${cy - 1}:${cz}`) &&
      occupied.has(`${cx}:${cy}:${cz + 1}`) &&
      occupied.has(`${cx}:${cy}:${cz - 1}`)
    ) {
      hidden.add(key);
    }
  }

  return hidden;
}

// ------------------------------------------------------------------ classe

export class BlockInstancing {
  private readonly root: THREE.Group;
  private readonly shadowGroup: THREE.Group;
  private readonly blocks = new Map<string, BlockState>();
  private readonly cellMap = new Map<string, { blockId: string; index: number }>();
  private readonly artByBlock = new Map<string, CubeArt>();

  /** Matriz temporária reutilizada para evitar alocação. */
  private readonly _matrix = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3(1, 1, 1);

  constructor(parent: THREE.Scene | THREE.Group) {
    this.root = new THREE.Group();
    this.root.name = 'block-instances';
    parent.add(this.root);

    this.shadowGroup = new THREE.Group();
    this.shadowGroup.name = 'block-shadows';
    parent.add(this.shadowGroup);
  }

  // ---------------------------------------------------- arte

  /** Registra (ou atualiza) a arte de um bloco. */
  setArt(blockId: string, art: CubeArt): void {
    const old = this.artByBlock.get(blockId);
    this.artByBlock.set(blockId, art);
    const state = this.blocks.get(blockId);
    if (state) {
      state.mesh.material = art.material;
      state.mesh.geometry = art.geometry;
    }
    // A arte antiga não é descartada aqui — o dono é a paleta (scene3d.ts).
  }

  /** Remove a arte de um bloco e todas as suas instâncias. */
  removeArt(blockId: string): void {
    const state = this.blocks.get(blockId);
    if (state) {
      this.disposeBlockState(state);
      this.blocks.delete(blockId);
    }
    this.artByBlock.delete(blockId);
  }

  // ---------------------------------------------------- células

  /**
   * Adiciona ou atualiza uma célula.
   *
   * Se a chave já existe com o mesmo blockId, não faz nada.
   * Se blockId mudou, move a instância de um InstancedMesh para o outro.
   * Retorna true se algo mudou.
   *
   * A arte do bloco precisa ter sido registrada com {@link setArt} antes.
   * Se não houver arte para `blockId`, retorna false sem fazer nada.
   */
  setCell(
    key: string,
    blockId: string,
    x: number,
    z: number, // map Y → Three.js Z
    y: number, // map Z (height) → Three.js Y
    cubeAngle: number,
  ): boolean {
    const art = this.artByBlock.get(blockId);
    if (!art) return false;

    const existing = this.cellMap.get(key);
    if (existing) {
      if (existing.blockId === blockId) return false;
      // Bloco trocou de tipo: remove do antigo, adiciona no novo.
      this.removeCell(key);
    }

    let state = this.blocks.get(blockId);
    if (!state) {
      state = this.createBlockState(blockId, art);
    }

    const index = this.allocateSlot(state);
    if (index === -1) return false; // shouldn't happen

    const cell: CellData = { blockId, x, y: z, z: y };

    // Sombra entre cubos — quad não-instanced com ShadowMaterial compartilhado.
    const shadowQuad = createCubeShadowQuad();
    shadowQuad.position.set(x, y + HALF_CUBE + SHADOW_QUAD_EPS, z);
    this.shadowGroup.add(shadowQuad);

    state.entries[index] = { cell, shadowQuad };
    this.cellMap.set(key, { blockId, index });
    (state.mesh.userData.cells as (CellData | null)[])[index] = cell;

    this.setInstanceMatrix(state.mesh, index, x, y, z, cubeAngle);
    this.updateCount(state);

    return true;
  }

  /** Remove uma célula e libera o slot. */
  removeCell(key: string): boolean {
    const mapped = this.cellMap.get(key);
    if (!mapped) return false;

    const state = this.blocks.get(mapped.blockId);
    this.cellMap.delete(key);

    if (!state) return true;

    const idx = mapped.index;
    const entry = state.entries[idx];
    if (entry) {
      this.shadowGroup.remove(entry.shadowQuad);
      state.entries[idx] = undefined;
      (state.mesh.userData.cells as (CellData | null)[])[idx] = null;
      state.freeList.push(idx);

      // Esconde a instância liberada com escala zero.
      const zero = new THREE.Matrix4();
      zero.makeScale(0, 0, 0);
      state.mesh.setMatrixAt(idx, zero);
      state.mesh.instanceMatrix.needsUpdate = true;
    }

    // Ajusta count se o slot liberado era o último ocupado.
    while (state.count > 0 && !state.entries[state.count - 1]) {
      state.count -= 1;
    }
    state.mesh.count = state.count;

    // Remove o bloco se ficou sem instâncias.
    if (state.count === 0 && state.freeList.length === state.capacity) {
      this.disposeBlockState(state);
      this.blocks.delete(mapped.blockId);
    }

    return true;
  }

  /** Remove todas as células cuja chave NÃO está em `seen`. */
  removeUnseen(seen: Set<string>): void {
    for (const key of this.cellMap.keys()) {
      if (!seen.has(key)) {
        this.removeCell(key);
      }
    }
  }

  /** A chave "x:z:y" está no mapa de instâncias? */
  hasCell(key: string): boolean {
    return this.cellMap.has(key);
  }

  /** Dados da célula para uma chave, ou null se não existir. */
  getCellInfo(key: string): CellData | null {
    const mapped = this.cellMap.get(key);
    if (!mapped) return null;
    const state = this.blocks.get(mapped.blockId);
    if (!state) return null;
    const entry = state.entries[mapped.index];
    return entry?.cell ?? null;
  }

  /**
   * Atualiza o blockId de uma célula já existente.
   *
   * Remove do InstancedMesh antigo e adiciona ao novo. A posição é preservada
   * (lida da entrada existente). Mais barato que removeCell + setCell porque
   * não precisa recomputar a posição a partir dos parâmetros x/z/y.
   *
   * A nova arte precisa ter sido registrada com {@link setArt}. Se não houver
   * arte para `newBlockId`, a célula é removida e retorna false.
   */
  updateCellBlockId(key: string, newBlockId: string): boolean {
    const mapped = this.cellMap.get(key);
    if (!mapped) return false;
    if (mapped.blockId === newBlockId) return false;

    const newArt = this.artByBlock.get(newBlockId);
    if (!newArt) {
      // Sem arte para o novo tipo — remove a célula.
      this.removeCell(key);
      return false;
    }

    // Guarda os dados da célula antes de remover.
    const oldState = this.blocks.get(mapped.blockId);
    const oldEntry = oldState?.entries[mapped.index];
    const cellX = oldEntry?.cell.x ?? 0;
    const cellZ = oldEntry?.cell.z ?? 0; // map Y → Three.js Z
    const cellY = oldEntry?.cell.z ?? 0; // height → Three.js Y

    // Remove do InstancedMesh antigo.
    this.removeCell(key);

    // Adiciona ao InstancedMesh novo (setCell vai criar o state se necessário).
    return this.setCell(key, newBlockId, cellX, cellZ, cellY, 0);
    // Nota: cubeAngle=0 aqui — o applyYaw logo em seguida corrige a rotação.
  }

  // ---------------------------------------------------- yaw

  /** Aplica rotação de yaw a TODAS as instâncias de todos os blocos. */
  applyYaw(cubeAngle: number): void {
    this._quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cubeAngle);

    for (const [, state] of this.blocks) {
      const mesh = state.mesh;
      for (let i = 0; i < state.entries.length; i += 1) {
        const entry = state.entries[i];
        if (!entry) continue;
        const c = entry.cell;
        this._pos.set(c.x, c.z + HALF_CUBE, c.y);
        this._matrix.compose(this._pos, this._quat, this._scale);
        mesh.setMatrixAt(i, this._matrix);

        // Sombra: só translação — o quad é plano no XZ e não acompanha a rotação.
        entry.shadowQuad.position.set(
          c.x,
          c.z + HALF_CUBE + SHADOW_QUAD_EPS,
          c.y,
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------- cor por instância

  /** Aplica uma cor a uma instância específica (multiplicativa com o material base). */
  setCellColor(key: string, color: THREE.Color): void {
    const mapped = this.cellMap.get(key);
    if (!mapped) return;
    const state = this.blocks.get(mapped.blockId);
    if (!state) return;

    // Inicializa instanceColor sob demanda.
    if (!state.mesh.instanceColor) {
      const arr = new Float32Array(state.capacity * 3);
      arr.fill(1); // branco = identidade multiplicativa
      state.mesh.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
    }
    state.mesh.setColorAt(mapped.index, color);
    if (state.mesh.instanceColor) {
      state.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Remove instanceColor se estiver definido para uma célula.
   *
   * Se NENHUMA célula do bloco tiver cor, o `instanceColor` é removido do
   * InstancedMesh, voltando ao material base puro (sem overhead).
   */
  clearCellColor(key: string): void {
    const mapped = this.cellMap.get(key);
    if (!mapped) return;
    const state = this.blocks.get(mapped.blockId);
    if (!state?.mesh.instanceColor) return;
    state.mesh.setColorAt(mapped.index, new THREE.Color(1, 1, 1));
    state.mesh.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------- consulta

  /** Todos os InstancedMesh (um por tipo de bloco). Para o raycaster. */
  getAllMeshes(): readonly THREE.InstancedMesh[] {
    return [...this.blocks.values()].map((s) => s.mesh);
  }

  /**
   * Dados da célula atingida por um raycaster em `mesh` na instância `instanceId`.
   * Devolve `null` se o índice não corresponder a uma célula ativa.
   */
  getCellForHit(
    mesh: THREE.InstancedMesh,
    instanceId: number,
  ): CellData | null {
    for (const [, state] of this.blocks) {
      if (state.mesh !== mesh) continue;
      const entry = state.entries[instanceId];
      return entry?.cell ?? null;
    }
    return null;
  }

  // ---------------------------------------------------- descarte

  /** Remove todos os meshes e libera recursos. */
  dispose(): void {
    for (const [, state] of this.blocks) {
      this.disposeBlockState(state);
    }
    this.blocks.clear();
    this.cellMap.clear();
    this.artByBlock.clear();

    // Remove os grupos da cena.
    this.root.removeFromParent();
    this.shadowGroup.removeFromParent();

    // Descarta os meshes de sombra (geometria e material são compartilhados,
    // cuidados por `disposeCubeCache` em cube3d.ts).
    this.shadowGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Não dá dispose em geometria/material — são compartilhados.
        obj.removeFromParent();
      }
    });
  }

  // ---------------------------------------------------- privados

  private createBlockState(blockId: string, art: CubeArt): BlockState {
    const mesh = new THREE.InstancedMesh(art.geometry, art.material, INITIAL_CAPACITY);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.name = `instanced-${blockId}`;
    mesh.count = 0;
    // Array de per-instance CellData para o raycaster acessar sem depender
    // do gerenciador de instâncias.
    mesh.userData.cells = new Array<CellData | null>(INITIAL_CAPACITY).fill(null);
    this.root.add(mesh);

    const state: BlockState = {
      mesh,
      entries: new Array(INITIAL_CAPACITY),
      freeList: [],
      count: 0,
      capacity: INITIAL_CAPACITY,
    };
    this.blocks.set(blockId, state);
    return state;
  }

  private allocateSlot(state: BlockState): number {
    // Primeiro a lista livre.
    if (state.freeList.length > 0) {
      return state.freeList.pop()!;
    }
    // Depois o próximo slot não usado dentro da capacidade.
    for (let i = 0; i < state.capacity; i += 1) {
      if (!state.entries[i]) return i;
    }
    // Esgotou: expande.
    this.growState(state);
    return state.entries.findIndex((e) => !e);
  }

  private growState(state: BlockState): void {
    const oldCapacity = state.capacity;
    const newCapacity = oldCapacity * 2;
    const oldMesh = state.mesh;

    const newMesh = new THREE.InstancedMesh(
      oldMesh.geometry,
      oldMesh.material,
      newCapacity,
    );
    newMesh.castShadow = true;
    newMesh.receiveShadow = false;
    newMesh.name = oldMesh.name;
    newMesh.count = 0;

    // Copia matrizes e conta as ativas.
    const m = new THREE.Matrix4();
    let maxIdx = -1;
    for (let i = 0; i < oldCapacity; i += 1) {
      if (state.entries[i]) {
        oldMesh.getMatrixAt(i, m);
        newMesh.setMatrixAt(i, m);
        maxIdx = i;
      }
    }
    newMesh.instanceMatrix.needsUpdate = true;

    // Copia o array de per-instance CellData para o raycaster.
    const oldCells = oldMesh.userData.cells as (CellData | null | undefined)[];
    const newCells = new Array<CellData | null>(newCapacity).fill(null);
    for (let i = 0; i < oldCapacity; i += 1) {
      newCells[i] = oldCells[i] ?? null;
    }
    newMesh.userData.cells = newCells;

    // Copia cores por instância se existirem.
    if (oldMesh.instanceColor) {
      const src = oldMesh.instanceColor.array as Float32Array;
      const dst = new Float32Array(newCapacity * 3);
      dst.fill(1);
      dst.set(src.subarray(0, oldCapacity * 3));
      newMesh.instanceColor = new THREE.InstancedBufferAttribute(dst, 3);
    }

    // Substitui na cena.
    this.root.remove(oldMesh);
    this.root.add(newMesh);

    // Atualiza o estado.
    state.mesh = newMesh;
    state.entries.length = newCapacity;
    state.capacity = newCapacity;
    state.count = maxIdx + 1;
    newMesh.count = state.count;

    // Descarta o mesh antigo (geometria e material NÃO — são compartilhados).
    oldMesh.dispose();
  }

  private setInstanceMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number, // height
    z: number, // map Y
    cubeAngle: number,
  ): void {
    this._pos.set(x, y + HALF_CUBE, z);
    this._quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cubeAngle);
    this._matrix.compose(this._pos, this._quat, this._scale);
    mesh.setMatrixAt(index, this._matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Atualiza `count` no mesh com base nos slots ocupados. */
  private updateCount(state: BlockState): void {
    let max = state.count;
    for (let i = state.count; i < state.capacity; i += 1) {
      if (state.entries[i]) max = i + 1;
    }
    // Também confere slots pós-count que possam ter sido preenchidos.
    if (max > state.count) {
      state.count = max;
      state.mesh.count = max;
    }
  }

  private disposeBlockState(state: BlockState): void {
    // Remove os quads de sombra.
    for (const entry of state.entries) {
      if (entry) this.shadowGroup.remove(entry.shadowQuad);
    }
    this.root.remove(state.mesh);
    // Geometria e material são compartilhados — NÃO dar dispose.
    state.mesh.dispose();
  }
}
