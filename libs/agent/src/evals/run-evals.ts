#!/usr/bin/env node
/**
 * Ghostfolio Agent CI Evaluation Runner
 *
 * Usage:
 *   Dry-run (validate dataset only, no API calls):
 *     npx ts-node libs/agent/src/evals/run-evals.ts --dry-run
 *
 *   Live eval (requires running agent + JWT):
 *     npx ts-node libs/agent/src/evals/run-evals.ts \
 *       --endpoint https://ghostfolio-production-1e9f.up.railway.app \
 *       --token YOUR_JWT_HERE
 *
 * CI Gate:
 *   Exit code 0 → pass (≥80% cases pass)
 *   Exit code 1 → fail (<80% cases pass OR dataset invalid)
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';

import {
  AgentResponse,
  EvalCase,
  EvalResult,
  evaluateResponse,
  summarizeResults,
  validateDataset
} from './evaluators';

const CI_PASS_THRESHOLD = 0.8;

function parseArgs(): {
  dryRun: boolean;
  endpoint: string | null;
  token: string | null;
  verbose: boolean;
  category: string | null;
} {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');

  const endpointIdx = args.indexOf('--endpoint');
  const endpoint = endpointIdx >= 0 ? args[endpointIdx + 1] : null;

  const tokenIdx = args.indexOf('--token');
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : null;

  const categoryIdx = args.indexOf('--category');
  const category = categoryIdx >= 0 ? args[categoryIdx + 1] : null;

  return { dryRun, endpoint, token, verbose, category };
}

function loadDataset(): EvalCase[] {
  const datasetPath = path.join(__dirname, 'eval-dataset.json');
  const raw = fs.readFileSync(datasetPath, 'utf-8');
  const dataset = JSON.parse(raw);

  return dataset.cases as EvalCase[];
}

async function callAgentEndpoint(
  endpoint: string,
  token: string,
  query: string,
  conversationId?: string
): Promise<AgentResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, conversationId });
    const url = new URL(`${endpoint}/api/v1/agent/chat`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`
      },
      timeout: 30000
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data) as AgentResponse);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 30s'));
    });

    req.write(body);
    req.end();
  });
}

function printResult(result: EvalResult, verbose: boolean): void {
  const status = result.passed ? '✅ PASS' : '❌ FAIL';
  console.log(
    `  ${status} [${result.caseId}] score: ${(result.score * 100).toFixed(0)}% (${result.durationMs}ms)`
  );

  if (verbose || !result.passed) {
    for (const check of result.checks) {
      const checkStatus = check.passed ? '    ✓' : '    ✗';
      console.log(`${checkStatus} ${check.name}: ${check.detail}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Ghostfolio Agent Evaluation Runner');
  console.log('═══════════════════════════════════════════════════════════');

  // Step 1: Load and validate dataset
  console.log('\n📋 Loading eval dataset...');
  let cases = loadDataset();

  const { valid, errors } = validateDataset(cases);
  if (!valid) {
    console.error('\n❌ Dataset validation failed:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`✅ Dataset valid: ${cases.length} cases`);

  // Filter by category if specified
  if (args.category) {
    cases = cases.filter((c) => c.category === args.category);
    console.log(
      `   Filtered to category "${args.category}": ${cases.length} cases`
    );
  }

  // Step 2: Dry-run mode — validate only, no API calls
  if (args.dryRun) {
    console.log('\n🔍 Dry-run mode: dataset validation only.');

    const categories: Record<string, number> = {};
    cases.forEach((c) => {
      categories[c.category] = (categories[c.category] || 0) + 1;
    });

    console.log('\nCase breakdown:');
    for (const [cat, count] of Object.entries(categories)) {
      console.log(`  ${cat}: ${count}`);
    }

    console.log(
      '\n✅ Dry-run complete. Dataset is valid and ready for live eval.'
    );
    console.log(
      '\nTo run live evals:  npx ts-node libs/agent/src/evals/run-evals.ts --endpoint <URL> --token <JWT>'
    );
    process.exit(0);
  }

  // Step 3: Live eval — requires endpoint + token
  if (!args.endpoint || !args.token) {
    console.error(
      '\n❌ Live eval requires --endpoint and --token. Use --dry-run to validate without API calls.'
    );
    process.exit(1);
  }

  console.log(`\n🚀 Running live evals against: ${args.endpoint}`);
  console.log(`   Cases: ${cases.length}`);
  console.log(
    `   CI gate: ${(CI_PASS_THRESHOLD * 100).toFixed(0)}% pass rate required\n`
  );

  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    process.stdout.write(
      `  Running [${evalCase.id}] "${evalCase.query.slice(0, 50)}..."  `
    );

    const start = Date.now();
    let response: AgentResponse;

    try {
      response = await callAgentEndpoint(
        args.endpoint,
        args.token,
        evalCase.query
      );
    } catch (error) {
      const durationMs = Date.now() - start;
      console.log(`⚠ ERROR: ${(error as Error).message}`);

      results.push({
        caseId: evalCase.id,
        category: evalCase.category,
        passed: false,
        score: 0,
        checks: [
          {
            name: 'api_call',
            passed: false,
            detail: `API error: ${(error as Error).message}`
          }
        ],
        durationMs
      });
      continue;
    }

    const durationMs = Date.now() - start;
    const result = evaluateResponse(evalCase, response, durationMs);
    results.push(result);

    console.log(''); // newline after progress indicator
    if (args.verbose || !result.passed) {
      printResult(result, args.verbose);
    } else {
      const status = result.passed ? '✅' : '❌';
      console.log(
        `  ${status} [${evalCase.id}] score: ${(result.score * 100).toFixed(0)}% (${durationMs}ms)`
      );
    }
  }

  // Step 4: Print summary
  const summary = summarizeResults(results);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  EVALUATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(
    `  Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed}`
  );
  console.log(
    `  Pass Rate: ${(summary.passRate * 100).toFixed(1)}% | Avg Score: ${(summary.avgScore * 100).toFixed(1)}%`
  );

  console.log('\n  By Category:');
  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    const icon = stats.passRate >= CI_PASS_THRESHOLD ? '✅' : '⚠';
    console.log(
      `  ${icon} ${cat}: ${stats.passed}/${stats.total} (${(stats.passRate * 100).toFixed(1)}%)`
    );
  }

  const gatePass = summary.passRate >= CI_PASS_THRESHOLD;

  console.log('\n═══════════════════════════════════════════════════════════');
  if (gatePass) {
    console.log(
      `  ✅ CI GATE PASSED: ${(summary.passRate * 100).toFixed(1)}% >= ${(CI_PASS_THRESHOLD * 100).toFixed(0)}%`
    );
  } else {
    console.log(
      `  ❌ CI GATE FAILED: ${(summary.passRate * 100).toFixed(1)}% < ${(CI_PASS_THRESHOLD * 100).toFixed(0)}%`
    );
    console.log('  Merge blocked. Fix failing test cases before merging.');
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(gatePass ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 Unexpected error:', err);
  process.exit(1);
});
