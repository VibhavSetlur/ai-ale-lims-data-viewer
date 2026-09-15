import { describe, expect, it } from 'vitest';
import { defaultOptionsForSpec, renderFigureSpecSvg, type LineChartFigureSpec } from './figureSpec';

describe('line chart figure export', () => {
  it('preserves complete lineage labels and makes room for every legend row', () => {
    const longLabel = 'DEL 6kb ACN3560 lineage with a complete sample name';
    const spec: LineChartFigureSpec = {
      kind: 'lineChart',
      title: 'Copy number trend',
      series: Array.from({ length: 15 }, (_, index) => ({
        id: `sample-${index}`,
        label: index === 0 ? longLabel : `sample-${index}`,
        color: '#2563eb',
        points: [{ x: index, y: index + 1 }],
      })),
    };

    const svg = renderFigureSpecSvg(spec, defaultOptionsForSpec(spec));

    expect(svg).toContain(longLabel);
    expect(svg).not.toContain('DEL 6kb ACN3560 line…');
    expect(svg).toContain('sample-14');
    expect(svg).not.toContain('+ 1 more lineages');
  });
});
