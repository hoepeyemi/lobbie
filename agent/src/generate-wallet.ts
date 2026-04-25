/**
 * Generate Wallet — Create a random EVM private key for the agent CLI
 *
 * Run: npm run generate-wallet  (from agent/)
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function main() {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  console.log('\n================================================================');
  console.log('  mogause — EVM AGENT KEY (dev / non-custodial)');
  console.log('================================================================\n');
  console.log(`  Address     : ${account.address}`);
  console.log(`  Private key : ${pk}`);
  console.log('----------------------------------------------------------------');
  console.log('\n  Add to agent/.env:');
  console.log(`  AGENT_PRIVATE_KEY=${pk}`);
  console.log('\n  Store this key securely; it controls funds for this address on any EVM network.');
  console.log('================================================================\n');
}

main();
