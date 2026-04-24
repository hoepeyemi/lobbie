import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";

const RPC_URL = process.env.DEPLOY_RPC_URL;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CHAIN_ID = Number(process.env.CHAIN_ID || "16602");

if (!RPC_URL) {
  throw new Error("Missing DEPLOY_RPC_URL in contracts/.env");
}

if (!PRIVATE_KEY) {
  throw new Error("Missing DEPLOYER_PRIVATE_KEY in contracts/.env");
}

const artifactPath = path.resolve(
  process.cwd(),
  "artifacts",
  "src",
  "AgentRegistry.sol",
  "AgentRegistry.json"
);

if (!fs.existsSync(artifactPath)) {
  throw new Error("Artifact not found. Run `npm run build` first.");
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
const wallet = new Wallet(PRIVATE_KEY, provider);
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);

async function main() {
  console.log("Deploying AgentRegistry...");
  console.log(`Network chainId: ${CHAIN_ID}`);
  console.log(`Deployer: ${wallet.address}`);

  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("Deployment complete.");
  console.log(`AgentRegistry address: ${address}`);
  console.log(`Explorer: https://chainscan-galileo.0g.ai/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
