/**
 * Test Client — Manual verification that the backend endpoints work
 *
 * This script calls each paid endpoint using the Stellar SDK.
 *
 * Run: npx tsx agent/src/test-client.ts
 * Requires: AGENT_PRIVATE_KEY in .env and backend running on AGENT_SERVER_URL
 */

import axios from 'axios';
import dotenv from 'dotenv';
import StellarSdk from '@stellar/stellar-sdk';

dotenv.config({ path: '../.env' });
dotenv.config();

const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const SERVER_URL = process.env.AGENT_SERVER_URL || 'http://localhost:3001';

if (!PRIVATE_KEY) {
  console.error('AGENT_PRIVATE_KEY not set. Run: npx tsx src/generate-wallet.ts');
  process.exit(1);
}

const alice = StellarSdk.Keypair.fromSecret(PRIVATE_KEY);

console.log('');
console.log('================================================================');
console.log('  STELLAR TEST CLIENT');
console.log('================================================================');
console.log(`  Server : ${SERVER_URL}`);
console.log(`  Payer  : ${alice.publicKey()}`);
console.log('================================================================');
console.log('');

async function testHealth() {
  console.log('[1/4] Testing /health (free)...');
  const res = await axios.get(`${SERVER_URL}/health`);
  console.log('  Status:', res.status);
  console.log('  Data:', JSON.stringify(res.data, null, 2));
  console.log('');
}

async function testWeather() {
  console.log('[2/4] Testing POST /api/weather (XLM)...');
  try {
    const res = await axios.post(`${SERVER_URL}/api/weather`, { city: 'Tokyo' });
    console.log('  Status:', res.status);
    console.log('  Data:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.log('  Error:', err.response?.status, err.response?.data || err.message);
  }
  console.log('');
}

async function testSummarize() {
  console.log('[3/4] Testing POST /api/summarize (XLM)...');
  try {
    const res = await axios.post(`${SERVER_URL}/api/summarize`, {
      text: 'The mogause protocol enables automatic payments for APIs using Stellar/Soroban.',
      maxLength: 100,
    });
    console.log('  Status:', res.status);
    console.log('  Data:', JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.log('  Error:', err.response?.status, err.response?.data || err.message);
  }
  console.log('');
}

async function runTests() {
    await testHealth();
    await testWeather();
    await testSummarize();
}

runTests().catch(console.error);
