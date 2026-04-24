import { parseAbi } from 'viem';

/**
 * Subset of `AgentRegistry` ABI for log indexing and view calls.
 * Must stay in sync with `contracts/src/AgentRegistry.sol`.
 */
export const agentRegistryAbi = parseAbi([
  'event AgentRegistered(address indexed agent, string category)',
  'function getAgent(address agent) view returns (string name, string endpoint, uint256 priceWei, string category, uint32 reputation, uint32 jobsCompleted, uint32 jobsFailed, uint256 totalEarned, bool isActive, uint64 registeredAt)',
  'function getEfficiencyScore(address agent) view returns (uint32)',
]);
