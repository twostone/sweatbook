import type { Muscle } from "../types.ts";

// Shapes of the body map in the session overview. Each shape is the corner points of the figure's left half in a
// VIEW_WIDTH × VIEW_HEIGHT box; the component mirrors it at the centre line and rounds it with smoothPath, so the
// table stays short and readable. Body parts that are no muscle group (head, hands, knees, …) are `base`.
export type Point = readonly [number, number];
export type Shape = readonly Point[];
export type BodyView = { base: readonly Shape[]; muscles: Partial<Record<Muscle, readonly Shape[]>> };

export const VIEW_WIDTH = 100;
export const VIEW_HEIGHT = 210;

const HEAD: Shape = [[44, 4], [50, 3], [50, 25], [45, 23], [42, 14]];
const NECK: Shape = [[45, 23], [50, 25], [50, 31], [40, 31]];
const HAND: Shape = [[20, 98], [27, 98], [26, 109], [21, 108]];
const KNEE: Shape = [[36, 153], [43, 153], [42, 160], [36, 160]];
const FOOT: Shape = [[36, 200], [41, 200], [42, 206], [33, 206]];
const SIDE_DELT: Shape = [[25, 35], [32, 30], [33, 32], [29, 47], [24, 47]];
const UPPER_ARM: Shape = [[24, 48], [30, 48], [32, 52], [29, 70], [23, 70], [22, 58]];
const FOREARM: Shape = [[22, 72], [29, 72], [28, 84], [27, 96], [21, 96], [20, 84]];

export const FRONT: BodyView = {
  base: [HEAD, NECK, HAND, KNEE, FOOT, [[40, 98], [50, 98], [50, 104], [44, 106]]],
  muscles: {
    side_delts: [SIDE_DELT],
    front_delts: [[[33, 32], [39, 32], [37, 41], [31, 48], [29, 47]]],
    chest: [[[39, 32], [50, 33], [50, 53], [41, 55], [34, 48], [37, 41]]],
    biceps: [UPPER_ARM],
    forearms: [FOREARM],
    core: [[[44, 56], [50, 55], [50, 97], [44, 97]]],
    obliques: [[[38, 58], [44, 56], [44, 97], [41, 97], [39, 80], [37, 66]]],
    quads: [[[35, 100], [40, 99], [44, 107], [45, 138], [43, 151], [36, 151], [33, 127]]],
    adductors: [[[44, 107], [50, 105], [49, 120], [45, 138]]],
    calves: [[[34, 161], [42, 161], [43, 177], [41, 198], [36, 198], [33, 178]]],
  },
};

export const BACK: BodyView = {
  base: [HEAD, NECK, HAND, KNEE, FOOT, [[40, 96], [50, 96], [50, 98], [38, 98]]],
  muscles: {
    upper_back: [[[45, 23], [50, 24], [50, 52], [43, 48], [39, 37], [33, 31]]],
    side_delts: [SIDE_DELT],
    rear_delts: [[[33, 32], [39, 36], [36, 43], [31, 48], [29, 47]]],
    triceps: [UPPER_ARM],
    forearms: [FOREARM],
    lats: [[[36, 43], [43, 48], [50, 53], [50, 62], [44, 79], [38, 71], [35, 54]]],
    lower_back: [[[39, 82], [44, 79], [50, 64], [50, 95], [41, 95]]],
    glutes: [[[37, 99], [50, 99], [50, 118], [41, 121], [35, 111]]],
    hamstrings: [[[35, 121], [41, 122], [49, 119], [47, 149], [43, 153], [36, 153], [34, 136]]],
    calves: [[[34, 160], [43, 160], [44, 176], [41, 198], [36, 198], [33, 176]]],
  },
};

// How far the curve bulges between corners: 1 is a plain Catmull-Rom spline, lower stays closer to the polygon.
const SMOOTHING = 0.9;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Closed Catmull-Rom spline through the corners as cubic Béziers: the soft look without hand-drawn curves.
export function smoothPath(shape: Shape): string {
  const n = shape.length;
  const at = (i: number) => shape[(i + n) % n]!;
  const pt = (x: number, y: number) => `${round1(x)},${round1(y)}`;
  let d = `M${pt(...at(0))}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const k = SMOOTHING / 6;
    const c1 = pt(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k);
    const c2 = pt(p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k);
    d += `C${c1} ${c2} ${pt(...p2)}`;
  }
  return `${d}Z`;
}
