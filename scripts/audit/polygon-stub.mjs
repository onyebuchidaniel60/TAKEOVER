// Local Polygon JSON-RPC stub for the Phase 5 audit ONLY (never use
// against real funds). Answers the read surface the escrow client needs
// with empty results: unknown receipts are null, log scans are empty.
// Effect: seeded funded/refunding/releasing rows read back unchanged —
// lazy transitions find nothing to do (future deadlines, null receipts)
// and, critically, NOTHING EVER BROADCASTS (broadcasts only trigger on
// past deadlines, which fixtures never have).
//
// Usage: node scripts/audit/polygon-stub.mjs [port]  (default 8546)
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? '8546') || 8546;

function answer(method) {
  switch (method) {
    case 'eth_chainId':
      return '0x89';
    case 'eth_blockNumber':
      return '0x100000';
    case 'eth_getTransactionReceipt':
    case 'eth_getBlockByNumber':
      return null;
    case 'eth_getLogs':
      return [];
    default:
      return null;
  }
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const respond = (p) => ({ jsonrpc: '2.0', id: p.id ?? null, result: answer(p.method) });
    const out = Array.isArray(payload) ? payload.map(respond) : respond(payload);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`polygon-stub listening on 127.0.0.1:${PORT}`);
});
