import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { loadInputs } from '../loadInputs.js';

config();

(async () => {
  try {
    const startedAt = Date.now();
    const { ga4Data, businessContext } = await loadInputs();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    const outPath = resolve(
      import.meta.dirname,
      '..',
      '..',
      'output',
      'ga4-fetch-result.json',
    );
    writeFileSync(outPath, JSON.stringify(ga4Data, null, 2), 'utf8');

    console.log(`\n[OK] GA4 取得完了 (${elapsed}s)`);
    console.log(`     書き出し先: ${outPath}`);
    console.log('     ─────────────────────────────────────────');
    console.log(`     dataSource     : ${businessContext.dataSource}`);
    console.log(`     industry       : ${businessContext.industry}`);
    console.log(`     property       : ${ga4Data.propertyId}`);
    console.log(`     siteName       : ${ga4Data.siteName}`);
    console.log(`     period         : ${ga4Data.period.start} 〜 ${ga4Data.period.end}`);
    console.log('     ─── summary ────────────────────────────');
    console.log(`     activeUsers    : ${ga4Data.summary.activeUsers.toLocaleString('ja-JP')}`);
    console.log(`     newUsers       : ${ga4Data.summary.newUsers.toLocaleString('ja-JP')}`);
    console.log(`     sessions       : ${ga4Data.summary.sessions.toLocaleString('ja-JP')}`);
    console.log(`     engagementRate : ${(ga4Data.summary.engagementRate * 100).toFixed(2)}%`);
    console.log(`     avgSessSec     : ${ga4Data.summary.averageSessionDuration.toFixed(1)}`);
    console.log(`     screenPageViews: ${ga4Data.summary.screenPageViews.toLocaleString('ja-JP')}`);
    console.log(`     conversions    : ${ga4Data.summary.conversions}`);
    console.log(`     totalRevenue   : ${ga4Data.summary.totalRevenue.toLocaleString('ja-JP')}`);
    console.log('     ─── comparison (vs prev period) ────────');
    console.log(`     prev period    : ${ga4Data.comparison.previousPeriod.start} 〜 ${ga4Data.comparison.previousPeriod.end}`);
    console.log(`     deltas         :`, ga4Data.comparison.summaryDeltas);
    console.log('     ─── breakdowns ─────────────────────────');
    console.log(`     channels       : ${ga4Data.channels.length}件`);
    for (const c of ga4Data.channels) {
      console.log(`       - ${c.name.padEnd(24)} sessions=${c.sessions} conv=${c.conversions}`);
    }
    console.log(`     topPages       : ${ga4Data.topPages.length}件 (上位5件)`);
    for (const p of ga4Data.topPages.slice(0, 5)) {
      console.log(`       - ${p.path.slice(0, 40).padEnd(40)} views=${p.views} engRate=${(p.engagementRate * 100).toFixed(0)}%`);
    }
    console.log(`     devices        :`, ga4Data.devices.map((d) => `${d.category}=${d.sessions}`).join(', '));
    console.log(`     geo (top 5)    :`, ga4Data.geo.slice(0, 5).map((g) => `${g.country}=${g.sessions}`).join(', '));
    console.log(`     dailyTrend     : ${ga4Data.dailyTrend.length}日分（${ga4Data.dailyTrend[0]?.date} 〜 ${ga4Data.dailyTrend.at(-1)?.date}）`);
  } catch (e) {
    console.error('\n[ERROR]', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exit(1);
  }
})();
