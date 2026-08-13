import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  config, getShardCapacity, getCompletedEvidence, extractEvidenceFromRun,
  listArtifacts, downloadArtifactEntries, dispatchWorkflow,
  putResearchFile, readRegistryCandidate, listRegistry, getContent,
} from './lib/github.mjs';
import { diagnoseEvidence, normalizeEvidence, tokenSimilarity } from './lib/diagnostics.mjs';

const VERSION = '0.1.0';
const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = '/mcp';

const text = (s) => [{ type: 'text', text: s }];
const result = (structuredContent, message = '') => ({ structuredContent, content: message ? text(message) : [] });

function summarizeEvidence(item) {
  const x = normalizeEvidence(item.data);
  return {
    runArtifact: item.artifactName,
    file: item.file,
    candidateId: x.id,
    pair: x.pair,
    status: x.status,
    development: x.dev,
    validation: x.val,
    stressPf: x.stressPf,
    captureRatePct: x.captureRatePct,
    mfeCapturePct: x.mfeCapturePct,
    givebackPct: x.givebackPct,
  };
}

function parseCsv(s) {
  const lines = s.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  const h = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(h.map((k, i) => [k, split(l)[i] ?? ''])));
}

function createCommander() {
  const server = new McpServer(
    { name: 'disdex-research-commander', version: VERSION },
    { instructions: 'Research-only DisDex backtest orchestration. Never access production, VPS, live runners, credentials, orders, accounts, positions, Frozen V6/Fresh Forward V9, or realTradingEnabled. Redesign from Development/Validation only; Confirmation/Holdout are not redesign inputs.' },
  );

  server.registerTool('get_research_status', {
    title: 'Get research status',
    description: 'Use this when the user wants current research BT shard capacity, queued/in-progress counts, and active GitHub Actions jobs.',
    inputSchema: { maxShards: z.number().int().min(1).max(5).default(5) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ maxShards }) => {
    const capacity = await getShardCapacity(maxShards);
    return result({ config: config(), ...capacity }, `Research shards: in_progress=${capacity.inProgress}, queued=${capacity.queued}, available=${capacity.available}`);
  });

  server.registerTool('get_completed_bt', {
    title: 'Get completed backtests',
    description: 'Use this when the user wants completed Development/Validation BT results and artifact-backed metrics from recent research workflows.',
    inputSchema: { limitRuns: z.number().int().min(1).max(20).default(5) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ limitRuns }) => {
    const batches = await getCompletedEvidence({ limitRuns });
    const completed = batches.flatMap((b) => b.evidence.map((e) => ({ run: b.run, ...summarizeEvidence(e) })));
    return result({ completed }, `Loaded ${completed.length} artifact-backed BT result(s).`);
  });

  server.registerTool('get_trade_ledger', {
    title: 'Get trade ledger',
    description: 'Use this when detailed trade-level diagnosis is needed for a completed research run. Reads only artifact CSV/JSON ledger files and returns a bounded sample plus file metadata.',
    inputSchema: {
      runId: z.number().int().positive(),
      candidate: z.string().min(1).optional(),
      maxRows: z.number().int().min(1).max(500).default(100),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ runId, candidate, maxRows }) => {
    const artifacts = await listArtifacts(runId);
    const matches = [];
    for (const a of artifacts) {
      if (candidate && !a.name.toLowerCase().includes(candidate.toLowerCase())) continue;
      const entries = await downloadArtifactEntries(a.id);
      for (const e of entries) {
        const n = e.name.toLowerCase();
        if (!/(ledger|trade)/.test(n) || !/(\.csv|\.json)$/.test(n)) continue;
        let rows = [];
        if (n.endsWith('.csv')) rows = parseCsv(e.text).slice(0, maxRows);
        else {
          try { const p = JSON.parse(e.text); rows = (Array.isArray(p) ? p : p.trades ?? p.ledger ?? []).slice(0, maxRows); } catch {}
        }
        matches.push({ artifactId: a.id, artifactName: a.name, file: e.name, returnedRows: rows.length, rows });
      }
    }
    return result({ runId, candidate: candidate ?? null, ledgers: matches }, `Found ${matches.length} ledger file(s).`);
  });

  server.registerTool('diagnose_candidate', {
    title: 'Diagnose candidate',
    description: 'Use this after a BT completes to identify the dominant Development/Validation loss mechanism before any redesign. Never uses Confirmation/Holdout for redesign.',
    inputSchema: {
      runId: z.number().int().positive(),
      candidate: z.string().min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ runId, candidate }) => {
    const evidence = await extractEvidenceFromRun(runId);
    const hit = evidence.find((e) => JSON.stringify(e.data).toLowerCase().includes(candidate.toLowerCase()) || e.artifactName.toLowerCase().includes(candidate.toLowerCase()));
    if (!hit) throw new Error(`Candidate ${candidate} not found in run ${runId} artifacts`);
    const diagnosis = diagnoseEvidence(hit.data);
    return result({ runId, artifact: hit.artifactName, diagnosis }, `Dominant cause: ${diagnosis.dominantCause.code}. Next structural action: ${diagnosis.dominantCause.action}`);
  });

  server.registerTool('launch_bt_shards', {
    title: 'Launch research BT shards',
    description: 'Use this only after diagnosis and candidate registration to dispatch one research-only GitHub Actions workflow without exceeding the 5-shard cap. Cannot dispatch production/live workflows.',
    inputSchema: {
      workflowFile: z.string().min(1),
      expectedShards: z.number().int().min(1).max(5),
      inputs: z.record(z.string()).default({}),
      acknowledgement: z.literal('RESEARCH_ONLY_EXECUTION'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  }, async (args) => {
    const launched = await dispatchWorkflow(args);
    return result(launched, `Dispatched ${args.workflowFile} for expected ${args.expectedShards} research shard(s).`);
  });

  server.registerTool('register_candidate', {
    title: 'Register research candidate',
    description: 'Use this to persist a research-only candidate specification and its D/V diagnosis linkage before launching BT. Writes only under research/commander/candidates on the research branch.',
    inputSchema: {
      candidateId: z.string().regex(/^[A-Za-z0-9_.-]+$/),
      pair: z.enum(['BTC','ETH','BNB','AVAX','SOL','LINK']),
      role: z.string().min(3),
      logicSummary: z.string().min(20).max(6000),
      parentCandidateId: z.string().optional(),
      diagnosisRef: z.object({ runId: z.number().int().positive(), candidate: z.string().min(1), dominantCause: z.string().min(1) }),
      devValidationOnly: z.literal(true),
      confirmationHoldoutUntouched: z.literal(true),
      acknowledgement: z.literal('RESEARCH_ONLY_REGISTRATION'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async (args) => {
    const existing = await readRegistryCandidate(args.candidateId);
    if (existing) return result({ registered: false, reason: 'ALREADY_EXISTS', existing }, `Candidate ${args.candidateId} already exists; no overwrite performed.`);
    const record = {
      schemaVersion: 1,
      candidateId: args.candidateId,
      pair: args.pair,
      role: args.role,
      logicSummary: args.logicSummary,
      parentCandidateId: args.parentCandidateId ?? null,
      diagnosisRef: args.diagnosisRef,
      devValidationOnly: true,
      confirmationHoldoutUntouched: true,
      registeredAt: new Date().toISOString(),
      safety: { productionAccess: false, vpsAccess: false, liveAccess: false, credentialAccess: false, orderAccess: false, accountAccess: false, positionAccess: false },
    };
    const path = `research/commander/candidates/${args.candidateId}.json`;
    const saved = await putResearchFile({ path, content: JSON.stringify(record, null, 2) + '\n', message: `research: register ${args.candidateId}` });
    return result({ registered: true, path, commitSha: saved.commit?.sha ?? null, record }, `Registered ${args.candidateId}.`);
  });

  server.registerTool('compare_lineage', {
    title: 'Compare candidate lineage',
    description: 'Use this before generating a new candidate to detect minor variants and repeated ideas in the research registry, reducing multiplicity and overfitting risk.',
    inputSchema: {
      pair: z.enum(['BTC','ETH','BNB','AVAX','SOL','LINK']),
      proposedLogicSummary: z.string().min(20).max(6000),
      minSimilarity: z.number().min(0).max(1).default(0.35),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ pair, proposedLogicSummary, minSimilarity }) => {
    const files = await listRegistry();
    const similar = [];
    for (const f of files.slice(0, 200)) {
      const id = f.name.replace(/\.json$/, '');
      const rec = await readRegistryCandidate(id);
      if (!rec || rec.pair !== pair) continue;
      const similarity = tokenSimilarity(proposedLogicSummary, rec.logicSummary ?? '');
      if (similarity >= minSimilarity) similar.push({ candidateId: id, role: rec.role, similarity, parentCandidateId: rec.parentCandidateId ?? null, logicSummary: rec.logicSummary });
    }
    similar.sort((a,b) => b.similarity - a.similarity);
    return result({ pair, minSimilarity, similar: similar.slice(0, 20), materiallyDistinct: similar.every((x) => x.similarity < 0.65) }, similar.length ? `Found ${similar.length} similar registered candidate(s).` : 'No similar registered candidates found.');
  });

  server.registerTool('get_guardrails', {
    title: 'Get commander guardrails',
    description: 'Use this to verify the Research Commander safety boundary and branch/repository scope.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => result({
    ...config(),
    tools: ['get_research_status','get_completed_bt','get_trade_ledger','diagnose_candidate','launch_bt_shards','register_candidate','compare_lineage','get_guardrails'],
    forbidden: ['production code','VPS','live runners','.env','credentials','API keys','orders','accounts','positions','approvals','Frozen V6','Fresh Forward V9','realTradingEnabled'],
    writesRestrictedTo: ['research/commander/candidates/*', 'research-only GitHub Actions workflow_dispatch'],
    redesignDataPolicy: 'Development/Validation only; Confirmation/Holdout excluded from redesign',
  }));

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) return res.writeHead(400).end('Missing URL');
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, mcp-session-id', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ name: 'DisDex Research Commander', version: VERSION, mode: 'research-only', mcp: MCP_PATH }));
  }
  if (url.pathname === MCP_PATH && ['POST','GET','DELETE'].includes(req.method ?? '')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    const server = createCommander();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end('Internal server error'); }
    return;
  }
  res.writeHead(404).end('Not Found');
});

httpServer.listen(PORT, () => console.log(`DisDex Research Commander listening on http://localhost:${PORT}${MCP_PATH}`));
