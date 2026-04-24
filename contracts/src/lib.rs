#![no_std]
use soroban_sdk::{
    contract, contracttype, 
    Address, Env, Symbol, 
    String
};
use core::cmp;
// Removed alloc::format as it's not available in this no_std environment without a proper allocator

// --- Constants & Error Codes ---
const REPUTATION_MAX: u32 = 10000;
const REPUTATION_SUCCESS_BONUS: u32 = 50;
const REPUTATION_FAILURE_PENALTY: u32 = 100;
const REPUTATION_INITIAL: u32 = 5000;
const ESCROW_TIMEOUT: u64 = 86400; // 24 hours in seconds

#[contracttype]
#[derive(Clone)]
pub struct AgentProfile {
    pub name: String,
    pub endpoint: String,
    pub price_xlm: i128,
    pub category: String,
    pub reputation: u32,
    pub jobs_completed: u32,
    pub jobs_failed: u32,
    pub total_earned: i128,
    pub is_active: bool,
    pub registered_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub requester: Address,
    pub worker: Address,
    pub amount: i128,
    pub category: String,
    pub status: String, // "pending", "complete", "failed", "disputed"
    pub parent_job_id: u64,
    pub created_at: u64,
    pub completed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    pub amount: i128,
    pub requester: Address,
    pub worker: Address,
    pub deadline: u64,
    pub settled: bool,
}

#[contracttype]
pub enum AgentEvent {
    AgentRegistered(Address, String),
    JobCreated(u64, Address),
    JobSettled(u64, String),
}

#[contract]
pub struct AgentRegistry;

impl AgentRegistry {
    // --- Public Functions ---

    pub fn register_agent(env: Env, caller: Address, name: String, endpoint: String, price_xlm: i128, category: String) {
        
        if env.storage().instance().has(&caller) {
            panic!("Agent already exists");
        }

        let profile = AgentProfile {
            name,
            endpoint,
            price_xlm,
            category: category.clone(),
            reputation: REPUTATION_INITIAL,
            jobs_completed: 0,
            jobs_failed: 0,
            total_earned: 0,
            is_active: true,
            registered_at: env.ledger().timestamp(),
        };

        env.storage().instance().set(&caller, &profile);
        
        // Update Category Leader
        let leader_key = Symbol::new(&env, "leader");
        let current_leader: Option<Address> = env.storage().instance().get(&leader_key);
        
        if current_leader.is_none() {
            env.storage().instance().set(&leader_key, &caller);
        }

        env.events().publish((caller, category.clone()), ());
    }

    pub fn update_agent(env: Env, caller: Address, endpoint: String, price_xlm: i128) {
        let mut profile: AgentProfile = env.storage().instance().get(&caller).unwrap();
        
        profile.endpoint = endpoint;
        profile.price_xlm = price_xlm;
        
        env.storage().instance().set(&caller, &profile);
    }

    pub fn create_job(env: Env, caller: Address, worker: Address, category: String, parent_job_id: u64) -> u64 {
        let worker_profile: AgentProfile = env.storage().instance().get(&worker).unwrap();
        let amount = worker_profile.price_xlm;
        
        if caller == worker {
            panic!("Cannot hire yourself");
        }

        let next_job_id_key = Symbol::new(&env, "next_job_id");
        let job_id = env.storage().instance().get(&next_job_id_key).unwrap_or(0) + 1;
        
        let job = Job {
            requester: caller.clone(),
            worker: worker.clone(),
            amount,
            category: category.clone(),
            status: String::from_str(&env, "pending"),
            parent_job_id,
            created_at: env.ledger().timestamp(),
            completed_at: 0,
        };

        let escrow = Escrow {
            amount,
            requester: caller,
            worker: worker.clone(),
            deadline: env.ledger().timestamp() + ESCROW_TIMEOUT,
            settled: false,
        };

        let job_key = Symbol::new(&env, "job");
        let escrow_key = Symbol::new(&env, "escrow");
        
        env.storage().instance().set(&job_key, &job);
        env.storage().instance().set(&escrow_key, &escrow);
        env.storage().instance().set(&next_job_id_key, &job_id);

        env.events().publish((job_id, worker), ());
        job_id
    }

    pub fn complete_job(env: Env, caller: Address, job_id: u64) {
        let job_key = Symbol::new(&env, "job");
        let escrow_key = Symbol::new(&env, "escrow");
        
        let mut job: Job = env.storage().instance().get(&job_key).expect("Job not found");
        let mut escrow: Escrow = env.storage().instance().get(&escrow_key).expect("Escrow not found");
        
        if caller != job.worker {
            panic!("Unauthorized: Only worker can complete");
        }
        if job.status != String::from_str(&env, "pending") || escrow.settled {
            panic!("Job already settled");
        }

        escrow.settled = true;
        job.status = String::from_str(&env, "complete");
        job.completed_at = env.ledger().timestamp();

        let mut worker_profile: AgentProfile = env.storage().instance().get(&job.worker).unwrap();
        worker_profile.reputation = cmp::min(REPUTATION_MAX, worker_profile.reputation + REPUTATION_SUCCESS_BONUS);
        worker_profile.jobs_completed += 1;
        worker_profile.total_earned += job.amount;

        env.storage().instance().set(&job.worker, &worker_profile);
        env.storage().instance().set(&job_key, &job);
        env.storage().instance().set(&escrow_key, &escrow);
        
        env.events().publish((job_id, String::from_str(&env, "complete")), ());
    }

    pub fn get_agent(env: Env, agent: Address) -> Option<AgentProfile> {
        env.storage().instance().get(&agent)
    }

    pub fn get_efficiency_score(env: Env, agent: Address) -> u32 {
        let profile: AgentProfile = env.storage().instance().get(&agent).unwrap();
        if profile.price_xlm > 0 {
            (profile.reputation as u64 * 1000 / profile.price_xlm as u64) as u32
        } else {
            0
        }
    }
}
