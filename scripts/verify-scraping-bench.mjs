import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const origin = process.env.SCRAPING_BENCH_URL || 'http://127.0.0.1:3159';
const checks = [];
async function check(name, run) {
  try { await run(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
const summaryResponse = await fetch(`${origin}/api/summary`);
const summary = await summaryResponse.json();
await check('The summary is served by the local database backend', () => {
  assert.equal(summaryResponse.status, 200);
  assert.equal(summaryResponse.headers.get('x-benchmark-storage'), 'neon');
  assert.equal(summary.schema_version, 2);
});
await check('The page identifies Scraping Bench and retains collected independent results', async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Scraping Bench/);
  assert.doesNotMatch(html, /Showing the saved run/);
  assert.ok(summary.cohorts['independent:new'].rows.every(row => row.count > 0));
});
await check('Best-output rankings disclose their subset and zero-score meaning', async () => {
  const html = await (await fetch(origin)).text();
  const section = html.split('id="coverage"')[1]?.split('</section>')[0] || '';
  assert.match(section, /have a resolved comparison/);
  assert.match(section, /A 0% share means no wins in this subset/);
  assert.match(section, /extraction settings differ/);
  assert.match(section, /best or tied out of/);
});
await check('Charts identify every provider equally and use plain headings', async () => {
  const html = await (await fetch(origin)).text();
  const chart = html.split('aria-label="Useful content (%) by provider"')[1]?.split('</section>')[0] || '';
  for (const id of ['context', 'exa', 'keenable', 'firecrawl']) assert.ok(chart.includes(`bg-provider-${id}`), id);
  assert.match(html, /Results by page category/);
  assert.match(html, /Provider coverage overlap/);
  assert.doesNotMatch(html, /Different pages,|What does one|scraper miss\?/);
});
for (const cohort of ['independent', 'needle']) {
  await check(`${cohort} results and detail share the publication version`, async () => {
    const response = await fetch(`${origin}/api/results?cohort=${cohort}&version=${summary.version}`);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(page.total > 0);
    assert.ok(page.records.length <= 8);
    const detail = await fetch(`${origin}/api/result?id=${page.records[0].id}&version=${summary.version}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).id, page.records[0].id);
  });
}
await check('A stale publication requests refresh instead of mixing results', async () => {
  assert.equal((await fetch(`${origin}/api/results?version=old`)).status, 409);
});
await check('Public downloads work and private paths are rejected', async () => {
  for (const path of ['/data/latest.json', '/data/run-sampling.json', '/data/replenishment.json', '/pricing.json', '/plan.md']) assert.equal((await fetch(origin + path)).status, 200, path);
  for (const path of ['/data/state.sqlite3', '/data/blobs/private.json', '/api/result?id=missing&version=' + summary.version]) assert.equal((await fetch(origin + path)).status, 404, path);
});
await check('Every exported run manifest is available and complete', async () => {
  const names = (await fs.readdir('artifacts/e2e/data/runs')).filter(name => name.endsWith('.json'));
  assert.ok(names.length > 0);
  for (let i = 0; i < names.length; i += 8) {
    await Promise.all(names.slice(i, i + 8).map(async name => {
      const response = await fetch(`${origin}/data/runs/${name}`);
      assert.equal(response.status, 200, name);
      assert.deepEqual(await response.json(), JSON.parse(await fs.readFile(`artifacts/e2e/data/runs/${name}`, 'utf8')));
    }));
  }
});
await check('Full history downloads are streamed without truncation', async () => {
  const response = await fetch(`${origin}/data/latest.json`);
  assert.equal(response.headers.get('transfer-encoding'), 'chunked');
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) > 4_500_000);
  assert.ok(JSON.parse(body).schema_version);
  for (const cohort of ['independent', 'needle']) {
    const download = await fetch(`${origin}/api/download?cohort=${cohort}&version=${summary.version}`);
    assert.equal(download.status, 200);
    const result = await download.json();
    assert.equal(result.records.length, result.total);
  }
});
await check('Publication is protected from unauthenticated requests', async () => {
  assert.equal((await fetch(`${origin}/api/publish`)).status, 401);
});
await check('Unsafe API methods are rejected', async () => {
  assert.equal((await fetch(`${origin}/api/summary`, { method: 'POST' })).status, 405);
});
await fs.mkdir('artifacts/e2e', { recursive: true });
const report = { origin, checkedAt: new Date().toISOString(), passed: checks.every(check => check.passed), checks };
await fs.writeFile('artifacts/e2e/http-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
