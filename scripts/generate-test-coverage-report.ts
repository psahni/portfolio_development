import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

type Metric = { total: number; covered: number; skipped: number; pct: number };
type FileCoverage = { lines: Metric; statements: Metric; functions: Metric; branches: Metric };
type CaseStatus = "passed" | "failed" | "skipped" | "flaky" | "pending";
type TestCase = { project: "Unit" | "Integration" | "End-to-end"; topic: string; file: string; title: string; status: CaseStatus; durationMs?: number };

type VitestAssertion = { ancestorTitles: string[]; title: string; fullName: string; status: string; duration?: number };
type VitestFileResult = { name: string; assertionResults: VitestAssertion[] };
type VitestReport = {
  numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number;
  testResults: VitestFileResult[];
};
type PlaywrightResult = { status: string; duration?: number; retry?: number };
type PlaywrightTest = { results: PlaywrightResult[]; status: string };
type PlaywrightSpec = { title: string; line?: number; file?: string; tests: PlaywrightTest[]; suites?: PlaywrightSuite[] };
type PlaywrightSuite = { title: string; file?: string; specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] };
type PlaywrightReport = { stats: { expected: number; skipped: number; unexpected: number; flaky: number; duration: number }; suites: PlaywrightSuite[] };

const root = process.cwd();
const coveragePath = resolve(root, "coverage/coverage-summary.json");
const vitestPath = resolve(root, "coverage/vitest-results.json");
const playwrightPath = resolve(root, "coverage/playwright-results.json");
const outputPath = resolve(root, "artifacts/reports/test-coverage.html");

const topicByFile: Record<string, string> = {
  "availability.test.ts": "Availability & scheduling",
  "booking.test.ts": "Booking & cancellation",
  "calendar-layout.test.ts": "Calendar layout",
  "clinic-configuration.test.ts": "Clinic configuration",
  "doctor-upgrade.test.ts": "Doctor agenda & cancellation",
  "env.test.ts": "Environment configuration",
  "foundation.test.ts": "Authentication foundation",
  "local-booking-email.test.ts": "Local booking email preview",
  "patient-destination.test.ts": "Patient navigation",
  "patient.test.ts": "Patient accounts & appointments",
  "staff.test.ts": "Staff access & management",
  "whatsapp.test.ts": "WhatsApp notifications",
  "auth.spec.ts": "Authentication & access",
  "availability.spec.ts": "Availability management",
  "booking.spec.ts": "Patient booking",
  "calendar.spec.ts": "Clinic calendar",
  "cancellation.spec.ts": "Patient cancellation",
  "clinic.spec.ts": "Clinic settings",
  "doctor-appointments.spec.ts": "Clinic appointment management",
  "patient.spec.ts": "Patient portal",
  "receptionist-booking.spec.ts": "Receptionist booking & cancellation",
  "staff.spec.ts": "Staff management",
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function relativeFile(value: string) {
  return relative(root, value).split(sep).join("/");
}

function statusOf(value: string): CaseStatus {
  if (value === "passed" || value === "expected") return "passed";
  if (value === "flaky") return "flaky";
  if (value === "skipped" || value === "pending" || value === "todo") return "skipped";
  return "failed";
}

function collectVitest(report: VitestReport): TestCase[] {
  return report.testResults.flatMap((fileResult) => {
    const file = relativeFile(fileResult.name);
    const project: TestCase["project"] = file.startsWith("tests/unit/") ? "Unit" : "Integration";
    const baseName = file.split("/").at(-1) ?? file;
    const topic = topicByFile[baseName] ?? project;
    return fileResult.assertionResults.map((test) => ({
      project,
      topic,
      file,
      title: [...test.ancestorTitles, test.title].filter(Boolean).join(" › "),
      status: statusOf(test.status),
      durationMs: test.duration,
    }));
  });
}

function collectPlaywright(report: PlaywrightReport): TestCase[] {
  const cases: TestCase[] = [];
  const visit = (suite: PlaywrightSuite, parents: string[] = [], inheritedFile = "") => {
    const file = suite.file ? (suite.file.startsWith("tests/") ? suite.file : `tests/e2e/${suite.file}`) : inheritedFile;
    const parentTitles = suite.title && suite.title !== file.split("/").at(-1) ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const specFile = spec.file ? (spec.file.startsWith("tests/") ? spec.file : `tests/e2e/${spec.file}`) : file;
      for (const test of spec.tests) {
        const results = test.results ?? [];
        const last = results.at(-1);
        const status: CaseStatus = results.length > 1 && last?.status === "passed" ? "flaky" : statusOf(last?.status ?? test.status);
        const baseName = specFile.split("/").at(-1) ?? specFile;
        cases.push({
          project: "End-to-end",
          topic: topicByFile[baseName] ?? "End-to-end",
          file: specFile,
          title: [...parentTitles.filter((title) => !title.endsWith(".spec.ts")), spec.title].filter(Boolean).join(" › "),
          status,
          durationMs: last?.duration,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, parentTitles, file);
  };
  for (const suite of report.suites) visit(suite);
  return cases;
}

function renderCase(caseItem: TestCase) {
  const searchable = [caseItem.project, caseItem.topic, caseItem.file, caseItem.title, caseItem.status].join(" ").toLowerCase();
  const duration = caseItem.durationMs === undefined ? "" : `${(caseItem.durationMs / 1000).toFixed(2)} s`;
  return `<article class="case-row" data-search="${escapeHtml(searchable)}" data-status="${caseItem.status}"><span class="status status-${caseItem.status}">${escapeHtml(caseItem.status)}</span><span class="case-title">${escapeHtml(caseItem.title)}</span><span class="case-meta">${escapeHtml(caseItem.file)}${duration ? ` · ${duration}` : ""}</span></article>`;
}

function renderCoverageRow(file: string, data: FileCoverage) {
  const line = data.lines.pct;
  const state = line < 60 ? "low" : line < 80 ? "mid" : "good";
  return `<tr><th scope="row"><code>${escapeHtml(file)}</code></th><td><span class="coverage-badge ${state}">${line.toFixed(2)}%</span></td><td>${data.lines.covered}/${data.lines.total}</td><td>${data.statements.pct.toFixed(2)}%</td><td>${data.branches.pct.toFixed(2)}%</td><td>${data.functions.pct.toFixed(2)}%</td></tr>`;
}

function coverageProgress(label: string, value: number, metric: Metric) {
  return `<div class="metric-card"><div class="metric-heading"><span>${label}</span><strong>${value.toFixed(2)}%</strong></div><progress max="100" value="${value}" aria-label="${label} coverage ${value.toFixed(2)} percent"></progress><small>${metric.covered.toLocaleString()} of ${metric.total.toLocaleString()} covered</small></div>`;
}

async function main() {
  const [coverageText, vitestText, playwrightText] = await Promise.all([
    readFile(coveragePath, "utf8"), readFile(vitestPath, "utf8"), readFile(playwrightPath, "utf8"),
  ]).catch(() => {
    throw new Error("Coverage inputs missing. Run pnpm test:coverage and PLAYWRIGHT_JSON_OUTPUT_NAME=coverage/playwright-results.json pnpm exec playwright test --reporter=json first.");
  });
  const coverage = JSON.parse(coverageText) as Record<string, FileCoverage>;
  const vitest = JSON.parse(vitestText) as VitestReport;
  const playwright = JSON.parse(playwrightText) as PlaywrightReport;
  const total = coverage.total;
  if (!total || !vitest.testResults || !playwright.suites) throw new Error("Coverage or test result files are missing required summary data.");

  const files = Object.entries(coverage).filter(([file]) => file !== "total").map(([file, stats]) => [relativeFile(file), stats] as const).sort((a, b) => a[1].lines.pct - b[1].lines.pct || a[0].localeCompare(b[0]));
  const cases = [...collectVitest(vitest), ...collectPlaywright(playwright)];
  const projects: TestCase["project"][] = ["Unit", "Integration", "End-to-end"];
  const groups = new Map<string, TestCase[]>();
  for (const test of cases) {
    const key = `${test.project}\u0000${test.topic}\u0000${test.file}`;
    groups.set(key, [...(groups.get(key) ?? []), test]);
  }
  const groupedMarkup = projects.map((project) => {
    const projectGroups = [...groups.entries()].filter(([key]) => key.startsWith(`${project}\u0000`));
    const projectCases = projectGroups.flatMap(([, entries]) => entries);
    const succeeded = projectCases.filter((test) => test.status === "passed").length;
    const flaky = projectCases.filter((test) => test.status === "flaky").length;
    const failed = projectCases.filter((test) => test.status === "failed").length;
    const summary = `${projectCases.length} cases · ${succeeded} passed${flaky ? ` · ${flaky} flaky` : ""}${failed ? ` · ${failed} failed` : ""}`;
    const projectBody = projectGroups.map(([key, entries]) => {
      const [, topic, file] = key.split("\u0000");
      const count = entries.length;
      return `<details class="case-group" data-project="${escapeHtml(project)}" data-topic="${escapeHtml(topic)}"><summary><span>${escapeHtml(topic)}</span><code>${escapeHtml(file)}</code><span class="group-count">${count} ${count === 1 ? "case" : "cases"}</span></summary><div class="case-list">${entries.map(renderCase).join("")}</div></details>`;
    }).join("");
    return `<section class="project-section" id="project-${project.toLowerCase()}"><div class="project-heading"><div><p class="overline">${escapeHtml(project)}</p><h3>${escapeHtml(project)} tests</h3></div><p class="project-summary">${escapeHtml(summary)}</p></div>${projectBody || `<p class="empty">No cases found.</p>`}</section>`;
  }).join("");

  const generatedAt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  const coverageRows = files.map(([file, stats]) => renderCoverageRow(file, stats)).join("");
  const topics = [...new Set(cases.map((test) => test.topic))].sort((a, b) => a.localeCompare(b));
  const topicOptions = topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join("");
  const passed = cases.filter((test) => test.status === "passed").length;
  const failed = cases.filter((test) => test.status === "failed").length;
  const skipped = cases.filter((test) => test.status === "skipped").length;
  const flaky = cases.filter((test) => test.status === "flaky").length;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Nuvortiq — Test coverage report</title>
<style>
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202036;background:#f6f7fb;font-synthesis:none;text-rendering:optimizeLegibility;--ink:#202036;--muted:#66677f;--line:#e4e5ef;--violet:#6845e8;--violet-soft:#eeeaff;--green:#176b56;--green-soft:#e5f5ee;--red:#a7384d;--red-soft:#fce9ec;--amber:#80551c;--amber-soft:#fff2d9}*{box-sizing:border-box}body{margin:0;line-height:1.5}.page{max-width:1280px;margin:auto;padding:32px 22px 64px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:26px}.overline{margin:0 0 6px;color:#6845e8;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1,h2,h3,p{margin-top:0}h1{margin-bottom:8px;font-size:clamp(28px,4vw,42px);letter-spacing:-.045em;line-height:1.1}.subtitle{max-width:760px;margin-bottom:0;color:var(--muted)}.stamp{flex:0 0 auto;padding:12px 15px;border:1px solid var(--line);border-radius:14px;background:#fff;color:var(--muted);font-size:12px}.stamp strong{display:block;color:var(--ink);font-size:13px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.metric-card,.summary-card,.panel{border:1px solid var(--line);border-radius:16px;background:#fff;box-shadow:0 4px 16px #25254a08}.metric-card{padding:17px}.metric-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;color:var(--muted);font-size:13px}.metric-heading strong{color:var(--ink);font-size:24px;letter-spacing:-.04em}progress{display:block;width:100%;height:8px;border:0;border-radius:9px;background:#ececf4}progress::-webkit-progress-bar{border-radius:9px;background:#ececf4}progress::-webkit-progress-value{border-radius:9px;background:linear-gradient(90deg,#6845e8,#9a68ef)}progress::-moz-progress-bar{border-radius:9px;background:linear-gradient(90deg,#6845e8,#9a68ef)}.metric-card small{display:block;margin-top:8px;color:var(--muted);font-size:11px}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:24px}.summary-card{padding:16px 18px}.summary-card span{display:block;color:var(--muted);font-size:12px}.summary-card strong{display:block;margin-top:5px;font-size:23px;letter-spacing:-.03em}.summary-card .passed{color:var(--green)}.summary-card .failed{color:var(--red)}.summary-card .flaky{color:var(--amber)}.panel{padding:22px;margin-top:20px}.panel-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}h2{margin-bottom:4px;font-size:22px;letter-spacing:-.035em}h3{margin:0;font-size:18px;letter-spacing:-.025em}.hint{max-width:760px;margin:4px 0 0;color:var(--muted);font-size:13px}.tools{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.tools input,.tools select{min-height:42px;border:1px solid #d7d8e6;border-radius:10px;background:#fff;padding:8px 12px;color:var(--ink);font:inherit}.tools input{flex:1 1 260px}.tools select{min-width:180px}.tools input:focus-visible,.tools select:focus-visible{outline:3px solid #7958f555;border-color:var(--violet)}.results-count{color:var(--muted);font-size:12px;align-self:center}.project-section{margin-top:22px}.project-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:20px 0 9px}.project-heading .overline{margin-bottom:3px}.project-summary{margin:0;color:var(--muted);font-size:12px}.case-group{overflow:hidden;margin:8px 0;border:1px solid var(--line);border-radius:12px;background:#fff}.case-group summary{display:grid;grid-template-columns:minmax(150px,1fr) minmax(190px,1.3fr) auto;align-items:center;gap:12px;padding:13px 15px;cursor:pointer;list-style:none}.case-group summary::-webkit-details-marker{display:none}.case-group summary::before{content:"＋";grid-column:1;grid-row:1;display:inline-grid;width:20px;height:20px;align-items:center;justify-content:center;margin-left:-4px;border-radius:6px;background:var(--violet-soft);color:var(--violet);font-size:13px}.case-group[open] summary::before{content:"−"}.case-group summary>span:first-of-type{grid-column:1;margin-left:22px;font-size:13px;font-weight:700}.case-group summary code{grid-column:2;grid-row:1;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.group-count{grid-column:3;grid-row:1;color:var(--muted);font-size:11px;white-space:nowrap}.case-list{border-top:1px solid var(--line)}.case-row{display:grid;grid-template-columns:78px minmax(0,1fr);gap:5px 12px;padding:11px 15px;border-bottom:1px solid #f0f0f5}.case-row:last-child{border-bottom:0}.case-title{font-size:13px;font-weight:600}.case-meta{grid-column:2;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.status{align-self:start;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;text-align:center;text-transform:uppercase}.status-passed{background:var(--green-soft);color:var(--green)}.status-failed{background:var(--red-soft);color:var(--red)}.status-flaky{background:var(--amber-soft);color:var(--amber)}.status-skipped,.status-pending{background:#f1f1f6;color:#55566c}.coverage-table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px 11px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}thead th{color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}th:first-child,td:first-child{text-align:left}tbody th{font-weight:600}tbody code{font-size:11px;white-space:normal;overflow-wrap:anywhere}.coverage-badge{display:inline-block;min-width:62px;padding:3px 7px;border-radius:99px;text-align:center;font-weight:800}.coverage-badge.good{background:var(--green-soft);color:var(--green)}.coverage-badge.mid{background:var(--amber-soft);color:var(--amber)}.coverage-badge.low{background:var(--red-soft);color:var(--red)}.scope-note{padding:14px 16px;border:1px solid #d9d4f7;border-radius:12px;background:#f7f5ff;color:#49436a;font-size:12px}.scope-note strong{color:#30225f}.empty{color:var(--muted);font-size:13px}.foot{margin-top:26px;color:var(--muted);font-size:11px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:860px){.cards,.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.top{display:block}.stamp{display:inline-block;margin-top:16px}}@media(max-width:560px){.page{padding:22px 13px 42px}.cards,.summary-grid{grid-template-columns:1fr 1fr;gap:9px}.metric-card{padding:12px}.metric-heading{display:block}.metric-heading strong{display:block}.panel{padding:15px}.panel-head,.project-heading{display:block}.project-summary{margin-top:5px}.case-group summary{grid-template-columns:1fr auto;gap:4px 8px}.case-group summary>span:first-of-type{grid-column:1;grid-row:1}.case-group summary code{grid-column:1;grid-row:2;margin-left:22px}.group-count{grid-column:2;grid-row:1}.case-row{grid-template-columns:66px minmax(0,1fr);padding-inline:10px}.case-meta{font-size:10px}th,td{padding:8px}.stamp{max-width:100%}}@media print{body{background:#fff}.page{max-width:none;padding:0}.panel,.metric-card,.summary-card{box-shadow:none;break-inside:avoid}.case-group{break-inside:avoid}.tools{display:none}}
</style></head><body><main class="page">
<header class="top"><div><p class="overline">Nuvortiq Smart Booking</p><h1>Test coverage report</h1><p class="subtitle">A complete inventory of unit, integration, and end-to-end test cases, alongside measured source-code coverage from the instrumented Vitest run.</p></div><div class="stamp"><strong>Generated ${escapeHtml(generatedAt)} IST</strong>${escapeHtml(branch)} · ${escapeHtml(commit)}${dirty ? " · working tree has uncommitted changes" : " · clean working tree"}</div></header>
<section aria-label="Code coverage metrics" class="cards">${coverageProgress("Line coverage", total.lines.pct, total.lines)}${coverageProgress("Statement coverage", total.statements.pct, total.statements)}${coverageProgress("Branch coverage", total.branches.pct, total.branches)}${coverageProgress("Function coverage", total.functions.pct, total.functions)}</section>
<section class="summary-grid" aria-label="Test execution summary"><div class="summary-card"><span>All inventoried cases</span><strong>${cases.length.toLocaleString()}</strong></div><div class="summary-card"><span>Passed</span><strong class="passed">${passed.toLocaleString()}</strong></div><div class="summary-card"><span>Failed</span><strong class="failed">${failed.toLocaleString()}</strong></div><div class="summary-card"><span>Skipped / flaky</span><strong class="flaky">${(skipped + flaky).toLocaleString()}</strong></div></section>
<aside class="scope-note"><strong>Coverage scope:</strong> Code percentages are measured from the unit and integration Vitest suites against all TypeScript source under <code>src/</code>. The 77 Playwright cases are listed and their execution results are shown, but they are not included in code coverage because browser code instrumentation is not configured. No project coverage threshold is currently set; percentages are measurements, not a pass/fail gate.</aside>
<section class="panel" aria-labelledby="inventory-title"><div class="panel-head"><div><h2 id="inventory-title">Test case inventory</h2><p class="hint">${vitest.numPassedTests} unit/integration cases passed and ${playwright.stats.expected} end-to-end cases passed. Expand a topic/file group to inspect individual cases.</p></div><div class="results-count" id="visible-count" aria-live="polite">${cases.length} cases shown</div></div><div class="tools"><label class="sr-only" for="case-search">Search tests</label><input id="case-search" type="search" placeholder="Search test title or file…"><label class="sr-only" for="topic-filter">Filter by topic</label><select id="topic-filter"><option value="">All topics</option>${topicOptions}</select><label class="sr-only" for="status-filter">Filter by result</label><select id="status-filter"><option value="">All results</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="flaky">Flaky</option><option value="skipped">Skipped</option></select></div>${groupedMarkup}</section>
<section class="panel" aria-labelledby="files-title"><div class="panel-head"><div><h2 id="files-title">Source file coverage</h2><p class="hint">Sorted from lowest to highest line coverage. Covered counts are shown for lines; percentages are independently measured for each metric.</p></div></div><div class="coverage-table-wrap"><table><caption class="sr-only">Coverage by source file</caption><thead><tr><th scope="col">Source file</th><th scope="col">Lines</th><th scope="col">Covered lines</th><th scope="col">Statements</th><th scope="col">Branches</th><th scope="col">Functions</th></tr></thead><tbody>${coverageRows}</tbody></table></div></section>
<footer class="foot">Generated from coverage/coverage-summary.json, coverage/vitest-results.json, and coverage/playwright-results.json. The standard Vitest HTML coverage detail is also available at coverage/index.html while the local ignored coverage artifacts remain present.</footer>
</main><script>
const search=document.getElementById('case-search'),topic=document.getElementById('topic-filter'),status=document.getElementById('status-filter'),count=document.getElementById('visible-count');
function filterCases(){const q=search.value.trim().toLowerCase(),t=topic.value,s=status.value;let shown=0;for(const group of document.querySelectorAll('.case-group')){let groupShown=0;for(const row of group.querySelectorAll('.case-row')){const matches=(!q||row.dataset.search.includes(q))&&(!t||group.dataset.topic===t)&&(!s||row.dataset.status===s);row.hidden=!matches;if(matches){groupShown++;shown++;}}group.hidden=groupShown===0;if(q&&groupShown)group.open=true;}count.textContent=shown.toLocaleString()+' cases shown';}
search.addEventListener('input',filterCases);topic.addEventListener('change',filterCases);status.addEventListener('change',filterCases);
</script></body></html>`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  process.stdout.write(`Wrote ${relativeFile(outputPath)} with ${cases.length} test cases and ${files.length} source files.\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Report generation failed."}\n`);
  process.exitCode = 1;
});
