/**
 * Generate Wallet — Create a testnet Stellar keypair for the agent and onboard it
 * 
 * This script generates a new keypair and uses the mogause backend to sponsor 
 * the account on Stellar (and any trustlines the backend includes in the sponsorship XDR).
 * 
 * Run: npx tsx agent/src/generate-wallet.ts
 */

import StellarSdk from '@stellar/stellar-sdk';

const SERVICE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function generateAndOnboardWallet() {
  try {
    console.log('\n================================================================');
    console.log('  mogause — STELLAR AGENT ONBOARDING');
    console.log('================================================================\n');

    // 1. Generate keypair
    console.log('Generating new Stellar keypair...');
    const agent = StellarSdk.Keypair.random();
    const publicKey = agent.publicKey();
    const secretKey = agent.secret();

    console.log(`  Public Key (Address) : ${publicKey}`);
    console.log(`  Private Key (Secret) : ${secretKey}`);
    console.log('----------------------------------------------------------------');

    // 2. Request sponsored account from mogause backend
    // Using the /create endpoint as per the provided guide
    console.log('\nRequesting sponsored Stellar account from mogause backend...');
    const createResponse = await fetch(`${SERVICE_URL}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_key: publicKey }),
    }).then(r => r.json());

    if (!createResponse.xdr) {
      throw new Error(`Onboarding failed: ${JSON.stringify(createResponse)}`);
    }

    const { xdr, network_passphrase } = createResponse;
    console.log('Sponsorship XDR received. Signing transaction...');

    // 3. Inspect, sign, and submit
    const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, network_passphrase);
    tx.sign(agent);

    // Using the /submit endpoint as per the provided guide
    const submitResponse = await fetch(`${SERVICE_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: tx.toXDR() }),
    }).then(r => r.json());

    if (submitResponse.error) {
      throw new Error(`Submission failed: ${submitResponse.error}`);
    }

    console.log('\n================================================================');
    console.log('  ONBOARDING SUCCESSFUL');
    console.log('================================================================');
    console.log(`  Agent Address : ${submitResponse.agent_public_key || publicKey}`);
    console.log(`  Explorer URL   : ${submitResponse.explorer_url || 'https://stellar.org/explorer'}`);
    console.log('----------------------------------------------------------------');
    console.log('\n  Add to your .env:');
    console.log(`  AGENT_PRIVATE_KEY=${secretKey}`);
    console.log('\n  Your agent is live on Stellar Testnet — fund with testnet XLM for x402 payments.');
    console.log('================================================================\n');

  } catch (error: any) {
    console.error('\n❌ Onboarding Error:');
    console.error(error.message);
    console.log('\nEnsure the backend server is running at:', SERVICE_URL);
    process.exit(1);
  }
}

generateAndOnboardWallet();

