// Historical weighted-search regression harness (pre-reading-first policy).
// Production's new multi-objective policy is verified by the separate reading
// and channel acceptance suites; old total cost is not their sole arbiter.
//
// Runs layout.mjs over the frozen corpus (the project flow files plus the
// nine reference examples), measures every output with the SAME semantic
// ruler the search optimizes (layout-metrics modelFromXml + diagramCost), and
// compares against the frozen legacy baseline measured when revision 9 was
// the production pipeline. Acceptance: every file's total cost is <= its
// baseline (plus documented local-optimum tolerance), every run exits 0, and
// every run stays inside the wall budget.
//
// Usage: node layout-regression.mjs [--json]
// Exit 0 = all files pass; 1 = regression or failure.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { modelFromXml } from './layout-metrics.mjs';
import { diagramCost } from './cost.mjs';

const HERE = new URL('.', import.meta.url).pathname;

// Frozen legacy (revision 9) totals, measured with the semantic ruler on the
// same corpus. The legacy pipeline is retired; treat these numbers as the
// acceptance contract rather than regenerating them.
// Frozen legacy geometry (revision 9 outputs) measured with the CURRENT
// semantic ruler, including the alignment lattice (lane columns, lane fit,
// side-by-side gap) and visual-sibling row terms. Re-baselined because the
// old numbers were measured under the pre-lattice ruler and are not
// comparable across the objective change.
const BASELINE = {
  proj_P_001: 6065,
  proj_P_002: 16893,
  proj_P_003: 7377,
  proj_P_004: 5968,
  ref_P_001: 22826,
  ref_P_002: 5227,
  ref_P_003: 12904,
  ref_P_004: 6804,
  ref_P_005: 15530,
  ref_P_006: 13825,
  ref_P_007: 11574,
  ref_P_008: 5497,
  ref_P_009: 31211,
};
// No tolerated exceptions under the regularity-aware objective: the former
// ref_P-008 local-optimum exception disappeared once spine/row terms reshaped
// the search landscape (it now lands below legacy). Keep the table empty but
// present so a future documented exception has one obvious home.
const TOLERANCE = {};

const WALL_BUDGET_MS = 30000; // runaway guard only; work is capped by the deterministic expansion budget

function corpus() {
  const files = [];
  const refRoot = join(HERE, '../../../../../examples/research-platform-comparison/good/design_files/flow_design');
  if (existsSync(refRoot)) {
    for (const name of readdirSync(refRoot).filter((n) => /^P-00\d\.bpmn$/.test(n)).sort()) {
      files.push({ tag: `ref_P_${name.slice(2, 5)}`, path: join(refRoot, name) });
    }
  }
  // Only the active research-platform project participates; other design
  // projects on this machine carry unrelated P-00x files with colliding tags.
  // Optional historical project corpus is explicit; never scan a user's home.
  const projectsRoot = process.env.DESIGN_LAYOUT_REGRESSION_PROJECTS_ROOT;
  if (projectsRoot && existsSync(projectsRoot)) {
    for (const dir of readdirSync(projectsRoot).sort()) {
      if (!dir.startsWith('agent-test-autoresearch-')) continue;
      const flowDir = join(projectsRoot, dir, 'design_files/flow_design');
      if (!existsSync(flowDir)) continue;
      for (const name of readdirSync(flowDir).filter((n) => /^P-00\d\.bpmn$/.test(n)).sort()) {
        files.push({ tag: `proj_P_${name.slice(2, 5)}`, path: join(flowDir, name) });
      }
    }
  }
  return files.filter((f) => BASELINE[f.tag] !== undefined);
}

async function measure(xml) {
  const model = await modelFromXml(xml);
  return Math.round(diagramCost(model).total);
}

const rows = [];
let failures = 0;
for (const { tag, path } of corpus()) {
  const input = readFileSync(path, 'utf8');
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [join(HERE, 'layout.mjs')], {
    input, encoding: 'utf8', timeout: 60000, maxBuffer: 16000000,
    env: {...process.env,BPMN_LAYOUT_READING:'0',BPMN_LAYOUT_CHANNELS:'0',BPMN_LAYOUT_EXPERIMENT_BUDGET:'0'},
  });
  const ms = Date.now() - t0;
  if (run.status !== 0) {
    failures += 1;
    rows.push({ tag, status: `EXIT ${run.status}`, ms });
    continue;
  }
  const total = await measure(run.stdout);
  const base = BASELINE[tag];
  const tol = TOLERANCE[tag] || 0;
  const ok = total <= base + tol && ms <= WALL_BUDGET_MS;
  if (!ok) failures += 1;
  rows.push({ tag, total, base, delta: total - base, ms, ok });
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ failures, rows }, null, 2)}\n`);
} else {
  process.stdout.write('tag         total   legacy    delta     wall\n');
  for (const r of rows) {
    if (r.total === undefined) {
      process.stdout.write(`${r.tag.padEnd(11)} ${r.status} ${r.ms}ms\n`);
      continue;
    }
    const mark = r.ok ? '  ' : 'FAIL';
    process.stdout.write(
      `${r.tag.padEnd(11)} ${String(r.total).padStart(6)} ${String(r.base).padStart(8)} ` +
        `${String(r.delta).padStart(7)} ${String(r.ms).padStart(7)}ms ${mark}\n`,
    );
  }
  const sum = rows.reduce((s, r) => s + (r.total || 0), 0);
  const baseSum = rows.reduce((s, r) => s + (r.base || 0), 0);
  process.stdout.write(
    `aggregate ${sum} vs legacy ${baseSum} (${(((baseSum - sum) / baseSum) * 100).toFixed(1)}% better)\n`,
  );
}
process.exit(failures === 0 ? 0 : 1);
