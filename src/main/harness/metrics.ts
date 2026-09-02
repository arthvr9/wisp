import { app } from 'electron';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SystemSampler } from './system';
import type { SystemSample } from './system';

export interface ProcessSample {
  elapsedS: number;
  pid: number;
  type: string;
  cpuPercent: number;
  workingSetKb: number;
}

export interface Summary {
  durationS: number;
  ticks: number;
  targetMs: number;
  deviation: { p50: number; p95: number; max: number };
  cpu: { mean: number; peak: number };
  systemCpu: Record<string, { mean: number; peak: number }>;
  memoryKbByProcess: Record<string, { mean: number; peak: number }>;
}

export class Harness {
  private readonly startedAt = performance.now();
  private readonly dir: string;
  private readonly deviations: number[] = [];
  private pendingTicks: string[] = [];
  private readonly totalsCpu: number[] = [];
  private readonly memory = new Map<string, number[]>();
  private readonly system = new SystemSampler();
  private readonly systemCpu = new Map<string, number[]>();
  private tickCount = 0;
  private finished = false;

  constructor(
    private readonly targetMs: number,
    resultsRoot: string,
  ) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = join(resultsRoot, stamp);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'ticks.csv'), 'elapsed_s,interval_ms,deviation_ms\n');
    writeFileSync(
      join(this.dir, 'processes.csv'),
      'elapsed_s,pid,type,cpu_percent,working_set_kb\n',
    );
  }

  get resultsDir(): string {
    return this.dir;
  }

  tick(intervalMs: number): void {
    this.tickCount += 1;
    const deviation = intervalMs - this.targetMs;
    this.deviations.push(deviation);
    this.pendingTicks.push(
      `${this.elapsedS().toFixed(3)},${intervalMs.toFixed(3)},${deviation.toFixed(3)}`,
    );
  }

  // The first getAppMetrics call has no previous reading to diff against, so its CPU numbers
  // are zero. Callers should discard the first sample.
  sampleProcesses(): ProcessSample[] {
    const elapsedS = this.elapsedS();
    const samples = app.getAppMetrics().map<ProcessSample>((m) => ({
      elapsedS,
      pid: m.pid,
      type: m.type,
      cpuPercent: m.cpu.percentCPUUsage,
      workingSetKb: m.memory.workingSetSize,
    }));

    const total = samples.reduce((sum, s) => sum + s.cpuPercent, 0);
    this.totalsCpu.push(total);
    for (const s of samples) {
      const key = `${s.type}:${s.pid}`;
      const list = this.memory.get(key) ?? [];
      list.push(s.workingSetKb);
      this.memory.set(key, list);
    }

    appendFileSync(
      join(this.dir, 'processes.csv'),
      samples
        .map(
          (s) =>
            `${s.elapsedS.toFixed(1)},${s.pid},${s.type},${s.cpuPercent.toFixed(2)},${s.workingSetKb}`,
        )
        .join('\n') + '\n',
    );
    this.flushTicks();
    return samples;
  }

  sampleSystem(): SystemSample[] {
    const elapsedS = this.elapsedS();
    const samples = this.system.sample();
    for (const s of samples) {
      const list = this.systemCpu.get(s.name) ?? [];
      list.push(s.cpuPercent);
      this.systemCpu.set(s.name, list);
    }
    if (samples.length > 0) {
      appendFileSync(
        join(this.dir, 'system.csv'),
        samples
          .map((s) => `${elapsedS.toFixed(1)},${s.pid},${s.name},${s.cpuPercent.toFixed(2)}`)
          .join('\n') + '\n',
      );
    }
    return samples;
  }

  discardFirstCpuSample(): void {
    this.totalsCpu.shift();
  }

  summary(): Summary {
    const sorted = [...this.deviations].sort((a, b) => a - b);
    const memoryKbByProcess: Summary['memoryKbByProcess'] = {};
    for (const [key, values] of this.memory) {
      memoryKbByProcess[key] = { mean: mean(values), peak: Math.max(...values) };
    }
    const systemCpu: Summary['systemCpu'] = {};
    for (const [key, values] of this.systemCpu) {
      systemCpu[key] = { mean: mean(values), peak: Math.max(...values) };
    }
    return {
      durationS: this.elapsedS(),
      ticks: this.tickCount,
      targetMs: this.targetMs,
      deviation: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.length > 0 ? (sorted[sorted.length - 1] ?? 0) : 0,
      },
      cpu: {
        mean: mean(this.totalsCpu),
        peak: this.totalsCpu.length > 0 ? Math.max(...this.totalsCpu) : 0,
      },
      systemCpu,
      memoryKbByProcess,
    };
  }

  finish(): Summary {
    if (this.finished) return this.summary();
    this.finished = true;
    this.flushTicks();
    const summary = this.summary();
    writeFileSync(join(this.dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    writeFileSync(join(this.dir, 'summary.txt'), formatSummary(summary) + '\n');
    return summary;
  }

  private elapsedS(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  private flushTicks(): void {
    if (this.pendingTicks.length === 0) return;
    appendFileSync(join(this.dir, 'ticks.csv'), this.pendingTicks.join('\n') + '\n');
    this.pendingTicks = [];
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function formatSummary(s: Summary): string {
  const lines = [
    `duration          ${s.durationS.toFixed(1)} s, ${s.ticks} ticks at ${s.targetMs} ms target`,
    `loop deviation    p50 ${s.deviation.p50.toFixed(2)} ms, p95 ${s.deviation.p95.toFixed(2)} ms, max ${s.deviation.max.toFixed(2)} ms`,
    `cpu (all procs)   mean ${s.cpu.mean.toFixed(2)} %, peak ${s.cpu.peak.toFixed(2)} %`,
  ];
  for (const [name, c] of Object.entries(s.systemCpu)) {
    lines.push(
      `cpu ${name.padEnd(14)}mean ${c.mean.toFixed(2)} %, peak ${c.peak.toFixed(2)} % (whole process, not only our share)`,
    );
  }
  lines.push('memory (working set, MB)');
  for (const [key, m] of Object.entries(s.memoryKbByProcess)) {
    lines.push(
      `  ${key.padEnd(20)} mean ${(m.mean / 1024).toFixed(1)}  peak ${(m.peak / 1024).toFixed(1)}`,
    );
  }
  return lines.join('\n');
}
