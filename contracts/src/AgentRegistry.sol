// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentRegistry {
    uint32 public constant REPUTATION_MAX = 10_000;
    uint32 public constant REPUTATION_SUCCESS_BONUS = 50;
    uint32 public constant REPUTATION_FAILURE_PENALTY = 100;
    uint32 public constant REPUTATION_INITIAL = 5_000;
    uint64 public constant ESCROW_TIMEOUT = 1 days;

    struct AgentProfile {
        string name;
        string endpoint;
        uint256 priceWei;
        string category;
        uint32 reputation;
        uint32 jobsCompleted;
        uint32 jobsFailed;
        uint256 totalEarned;
        bool isActive;
        uint64 registeredAt;
    }

    struct Job {
        address requester;
        address worker;
        uint256 amount;
        string category;
        string status;
        uint64 parentJobId;
        uint64 createdAt;
        uint64 completedAt;
    }

    struct Escrow {
        uint256 amount;
        address requester;
        address worker;
        uint64 deadline;
        bool settled;
    }

    mapping(address => AgentProfile) private agents;
    mapping(address => bool) private agentExists;
    mapping(uint64 => Job) private jobs;
    mapping(uint64 => Escrow) private escrows;

    uint64 public nextJobId;
    address public categoryLeader;

    event AgentRegistered(address indexed agent, string category);
    event AgentUpdated(address indexed agent);
    event JobCreated(uint64 indexed jobId, address indexed worker, uint256 amount);
    event JobSettled(uint64 indexed jobId, string status);

    error AgentAlreadyExists();
    error AgentNotFound();
    error CannotHireSelf();
    error JobNotFound();
    error EscrowNotFound();
    error Unauthorized();
    error JobAlreadySettled();
    error InvalidPaymentAmount();

    function registerAgent(
        string calldata name,
        string calldata endpoint,
        uint256 priceWei,
        string calldata category
    ) external {
        if (agentExists[msg.sender]) revert AgentAlreadyExists();

        agents[msg.sender] = AgentProfile({
            name: name,
            endpoint: endpoint,
            priceWei: priceWei,
            category: category,
            reputation: REPUTATION_INITIAL,
            jobsCompleted: 0,
            jobsFailed: 0,
            totalEarned: 0,
            isActive: true,
            registeredAt: uint64(block.timestamp)
        });
        agentExists[msg.sender] = true;

        if (categoryLeader == address(0)) {
            categoryLeader = msg.sender;
        }

        emit AgentRegistered(msg.sender, category);
    }

    function updateAgent(string calldata endpoint, uint256 priceWei) external {
        if (!agentExists[msg.sender]) revert AgentNotFound();

        AgentProfile storage profile = agents[msg.sender];
        profile.endpoint = endpoint;
        profile.priceWei = priceWei;

        emit AgentUpdated(msg.sender);
    }

    function createJob(address worker, string calldata category, uint64 parentJobId) external payable returns (uint64) {
        if (!agentExists[worker]) revert AgentNotFound();
        if (msg.sender == worker) revert CannotHireSelf();

        uint256 amount = agents[worker].priceWei;
        if (msg.value != amount) revert InvalidPaymentAmount();

        uint64 jobId = ++nextJobId;

        jobs[jobId] = Job({
            requester: msg.sender,
            worker: worker,
            amount: amount,
            category: category,
            status: "pending",
            parentJobId: parentJobId,
            createdAt: uint64(block.timestamp),
            completedAt: 0
        });

        escrows[jobId] = Escrow({
            amount: amount,
            requester: msg.sender,
            worker: worker,
            deadline: uint64(block.timestamp) + ESCROW_TIMEOUT,
            settled: false
        });

        emit JobCreated(jobId, worker, amount);
        return jobId;
    }

    function completeJob(uint64 jobId) external {
        Job storage job = jobs[jobId];
        Escrow storage escrow = escrows[jobId];

        if (job.worker == address(0)) revert JobNotFound();
        if (escrow.worker == address(0)) revert EscrowNotFound();
        if (msg.sender != job.worker) revert Unauthorized();
        if (escrow.settled || !_isPending(job.status)) revert JobAlreadySettled();

        escrow.settled = true;
        job.status = "complete";
        job.completedAt = uint64(block.timestamp);

        AgentProfile storage workerProfile = agents[job.worker];
        uint32 boosted = workerProfile.reputation + REPUTATION_SUCCESS_BONUS;
        workerProfile.reputation = boosted > REPUTATION_MAX ? REPUTATION_MAX : boosted;
        workerProfile.jobsCompleted += 1;
        workerProfile.totalEarned += job.amount;

        (bool sent, ) = payable(job.worker).call{value: escrow.amount}("");
        require(sent, "Transfer failed");

        emit JobSettled(jobId, "complete");
    }

    function getAgent(address agent) external view returns (AgentProfile memory) {
        if (!agentExists[agent]) revert AgentNotFound();
        return agents[agent];
    }

    function getJob(uint64 jobId) external view returns (Job memory) {
        if (jobs[jobId].worker == address(0)) revert JobNotFound();
        return jobs[jobId];
    }

    function getEfficiencyScore(address agent) external view returns (uint32) {
        if (!agentExists[agent]) revert AgentNotFound();

        AgentProfile memory profile = agents[agent];
        if (profile.priceWei == 0) {
            return 0;
        }

        return uint32((uint256(profile.reputation) * 1000) / profile.priceWei);
    }

    function _isPending(string memory status) private pure returns (bool) {
        return keccak256(bytes(status)) == keccak256(bytes("pending"));
    }
}
