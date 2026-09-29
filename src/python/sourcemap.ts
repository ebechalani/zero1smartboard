/**
 * Sketch line ↔ Python line (docs/PYTHON.md §4.9). The emitter records, for every line of the
 * generated sketch, the first line of the Python statement it was made from; scaffolding (header,
 * includes, pin constants, braces, labels, helper bodies) records 0.
 */
export class SourceMap {
  /** sketchToPython[sketchLine - 1] = Python line (1-based); 0 for scaffolding and helper bodies. */
  readonly sketchToPython: readonly number[];

  constructor(sketchToPython: readonly number[]) {
    this.sketchToPython = [...sketchToPython];
  }

  /** The Python line a sketch line was made from; 0 when unknown. */
  pythonLineOf(sketchLine: number): number {
    return this.sketchToPython[sketchLine - 1] ?? 0;
  }

  /** Every sketch line (1-based, in order) made from that Python line. */
  sketchLinesOf(pythonLine: number): number[] {
    const lines: number[] = [];
    if (pythonLine <= 0) return lines;
    this.sketchToPython.forEach((line, i) => {
      if (line === pythonLine) lines.push(i + 1);
    });
    return lines;
  }

  /** transpile()'s lineMap (JS line → sketch line) composed with this map (JS line → Python line). */
  composeJsLineMap(jsLineMap: readonly number[]): number[] {
    return jsLineMap.map((sketchLine) => (sketchLine ? this.pythonLineOf(sketchLine) : 0));
  }
}
