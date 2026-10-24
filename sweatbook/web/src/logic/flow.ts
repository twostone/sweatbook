import type { SessionBlock } from "../types.ts";

// A logged set is done (no ticks before planned sets in phase 2), so a block's state follows from where sets are:
// the last block with sets is the one being worked on, earlier ones with sets are done, the others are open.
export type BlockStatus = "done" | "current" | "open";

const hasSets = (block: SessionBlock) => block.exercises.some((e) => e.sets.length > 0);

function currentIndex(blocks: SessionBlock[]): number {
  return blocks.findLastIndex(hasSets);
}

export function blockStatus(blocks: SessionBlock[], index: number): BlockStatus {
  const current = currentIndex(blocks);
  if (index === current) return "current";
  return hasSets(blocks[index]!) && index < current ? "done" : "open";
}

export const doneCount = (blocks: SessionBlock[]) => blocks.filter((_, i) => blockStatus(blocks, i) === "done").length;

// "Weiter" on the overview: back to the block being worked on, or the first one when nothing is logged yet.
export function overviewTarget(blocks: SessionBlock[]): SessionBlock | null {
  return blocks[currentIndex(blocks)] ?? blocks[0] ?? null;
}

// "Weiter" on an exercise page: the next block in order; null after the last one.
export function nextBlock(blocks: SessionBlock[], blockId: string): SessionBlock | null {
  const index = blocks.findIndex((b) => b.id === blockId);
  return index === -1 ? null : (blocks[index + 1] ?? null);
}

// Within a superset round the next set is due at the first exercise with the fewest sets (A2 after A1, then A1 again).
export function nextInRound(exercises: { sets: unknown[] }[]): number {
  const fewest = Math.min(...exercises.map((e) => e.sets.length));
  return Math.max(0, exercises.findIndex((e) => e.sets.length === fewest));
}
