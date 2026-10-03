import type { Chart } from '../../shared/dashboard.js';

export * from '../../shared/plan.js';

let counter = 0;
export function newChartId(): Chart['id'] {
  counter += 1;
  return `chart_${Date.now().toString(36)}_${counter}`;
}
