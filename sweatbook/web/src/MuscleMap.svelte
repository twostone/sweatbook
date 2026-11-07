<script lang="ts">
  import { BACK, FRONT, smoothPath, VIEW_HEIGHT, VIEW_WIDTH, type BodyView } from "./logic/muscle-map";
  import { HEAT_LEVELS, heatLevel, MUSCLE_LABELS, type MuscleSummary } from "./logic/muscles";
  import type { Muscle } from "./types";

  // Body map of a session, front and back: each muscle group shaded by its weighted sets relative to the most
  // trained one. The numbers are in the list below it; the map only gives the picture.
  let { summary }: { summary: MuscleSummary } = $props();

  const maxSets = $derived(Math.max(...summary.muscles.map((m) => m.sets), 1));
  const levels = $derived(new Map(summary.muscles.map((m) => [m.muscle, heatLevel(m.sets, maxSets)])));
  const label = $derived(`Trainiert: ${summary.muscles.map((m) => MUSCLE_LABELS[m.muscle]).join(", ")}`);
  const views: { caption: string; view: BodyView }[] = [
    { caption: "Vorne", view: FRONT },
    { caption: "Hinten", view: BACK },
  ];
  const steps = Array.from({ length: HEAT_LEVELS }, (_, i) => i + 1);
  // The shapes are the left half; the right half is the same group mirrored at the centre line.
  const mirror = `translate(${VIEW_WIDTH},0) scale(-1,1)`;
  const entries = (view: BodyView) => Object.entries(view.muscles) as [Muscle, BodyView["base"]][];
</script>

{#snippet half(view: BodyView)}
  {#each view.base as shape, i (i)}<path class="base" d={smoothPath(shape)} />{/each}
  {#each entries(view) as [muscle, shapes] (muscle)}
    {#each shapes as shape, i (i)}<path class="muscle heat-{levels.get(muscle) ?? 0}" d={smoothPath(shape)} />{/each}
  {/each}
{/snippet}

<div class="map" role="img" aria-label={label}>
  {#each views as { caption, view } (caption)}
    <figure>
      <svg viewBox="0 0 {VIEW_WIDTH} {VIEW_HEIGHT}" aria-hidden="true">
        <g>{@render half(view)}</g>
        <g transform={mirror}>{@render half(view)}</g>
      </svg>
      <figcaption aria-hidden="true">{caption}</figcaption>
    </figure>
  {/each}
</div>
<p class="scale" aria-hidden="true">
  wenig {#each steps as s (s)}<i class="heat-{s}"></i>{/each} viel
</p>

<style>
  .map {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  figcaption {
    font: 600 12px/1 var(--display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  svg {
    width: 100%;
    max-width: 170px;
    height: auto;
    display: block;
  }
  .base {
    fill: var(--body);
  }
  .muscle {
    stroke: var(--surface);
    stroke-width: 1.1;
    stroke-linejoin: round;
    transition: fill 0.25s;
  }
  .scale {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .scale i {
    width: 18px;
    height: 10px;
    border-radius: 3px;
  }
  .heat-0 {
    fill: var(--heat-0);
  }
  .heat-1 {
    fill: var(--heat-1);
    background: var(--heat-1);
  }
  .heat-2 {
    fill: var(--heat-2);
    background: var(--heat-2);
  }
  .heat-3 {
    fill: var(--heat-3);
    background: var(--heat-3);
  }
  .heat-4 {
    fill: var(--heat-4);
    background: var(--heat-4);
  }
</style>
