# mogause Frontend Migration Guide: Stacks → Stellar

**Current product:** Stellar network only; x402 settlement uses native **XLM**.

## Overview

This document describes the migration of the mogause frontend from **Stacks Connect** to **Stellar Wallets Kit**, enabling support for multiple Stellar wallets (Freighter, LOBSTR, xBull, Albedo, etc.) instead of Stacks wallets.

Current frontend deployment mode:

- Static export build output goes to `frontend/build/` via `npm run build`
- Brand logo + favicon use `public/mogause.png`

---

## What Changed

### Removed Dependencies
- `@stacks/connect` - Stacks wallet connection library
- `@stacks/network` - Stacks network utilities

### Added Dependencies
- `@creit.tech/stellar-wallets-kit` - Unified multi-wallet support for Stellar
- `@stellar/stellar-sdk` - Stellar blockchain SDK (already present)

---

## File Changes

### 1. **New File: `src/lib/WalletProvider.tsx`**
   - Creates a React Context for wallet state management
   - Initializes `StellarWalletsKit` with TESTNET configuration
   - Provides `connect`, `disconnect`, and `signTransaction` methods
   - Persists wallet selection in localStorage

### 2. **Updated: `src/app/Providers.tsx`**
   - Wrapped application with `WalletProvider`
   - Maintains existing `LanguageProvider`

### 3. **Updated: `src/components/ConnectWalletButton.tsx`**
   - Replaced Stacks authentication with Stellar wallet connection
   - Uses `useWallet` hook instead of `userSession`
   - Displays Stellar address (G... format) instead of Stacks address (ST... format)

### 4. **Updated: `src/lib/userSession.ts`**
   - Deprecated Stacks-specific functions
   - Re-exports `useWallet` for backward compatibility
   - Added deprecation warnings

### 5. **Updated: `src/components/WalletInfo.tsx`**
   - Changed balance fetch from Hiro API to Stellar Horizon API
   - Updated currency display from STX to XLM
   - Updated network badge to "STELLAR TESTNET"

### 6. **Updated: `package.json`**
   - Removed `@stacks/connect` and `@stacks/network`
   - Kept `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk`

### 7. **New File: `.env.example`**
   - Added Stellar-specific environment variables
   - Removed Stacks-specific configuration

---

## Supported Wallets

The Stellar Wallets Kit supports:

| Wallet     | Type          | Platforms           |
|------------|---------------|---------------------|
| Freighter  | Extension     | Chrome, Firefox     |
| LOBSTR     | Extension/Mobile | Chrome, iOS, Android |
| xBull      | Extension     | Chrome              |
| Albedo     | Web-based     | All browsers        |
| Rabet      | Extension     | Chrome              |
| Hana       | Extension     | Chrome              |
| Ledger     | Hardware      | USB                 |
| Trezor     | Hardware      | USB                 |
| WalletConnect | Protocol   | Mobile wallets      |

---

## Installation

After pulling these changes, run:

```bash
cd frontend
npm install
```

This will install the Stellar Wallets Kit and remove Stacks dependencies.

---

## Configuration

### 1. Update `.env.local`

Create or update your `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:4002
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SERVER_ADDRESS=G...  # Your backend's Stellar public key
```

### 2. Install Freighter Wallet (Recommended)

For the best experience, install the **Freighter wallet** browser extension:
- [Download Freighter](https://www.freighter.app/)

---

## Usage

### For Users

1. Click "Connect Wallet" in the navbar
2. Select your preferred wallet from the modal
3. Approve the connection in your wallet
4. Your Stellar address will appear in the navbar

### For Developers

#### Basic Usage

```tsx
import { useWallet } from '@/lib/WalletProvider';

function MyComponent() {
  const { address, connect, disconnect, isConnected, signTransaction } = useWallet();

  return (
    <div>
      {isConnected ? (
        <p>Connected: {address}</p>
      ) : (
        <button onClick={connect}>Connect Wallet</button>
      )}
    </div>
  );
}
```

#### Signing Transactions

```tsx
import * as StellarSdk from "@stellar/stellar-sdk";
import { useWallet } from '@/lib/WalletProvider';

async function submitPayment() {
  const { signTransaction } = useWallet();
  
  // Create transaction
  const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
  const sourceAccount = await server.loadAccount(walletAddress);
  
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: recipientAddress,
      asset: StellarSdk.Asset.native(),
      amount: '10',
    }))
    .setTimeout(30)
    .build();

  // Sign with wallet
  const signedXdr = await signTransaction(transaction.toXDR());
  
  // Submit to network
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    StellarSdk.Networks.TESTNET
  );
  
  const result = await server.submitTransaction(signedTx);
  return result;
}
```

---

## Breaking Changes

### Removed APIs

- `userSession.isUserSignedIn()` → Use `isConnected` from `useWallet`
- `userSession.loadUserData()` → Use `address` from `useWallet`
- `authenticate()` → Use `connect()` from `useWallet`
- `sign_out()` → Use `disconnect()` from `useWallet`

### Address Format

- **Old (Stacks)**: `ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB`
- **New (Stellar)**: `GDRM3...` (56-character public key)

### Balance Format

- **Old**: STX (Stacks native token)
- **New**: XLM (Stellar Lumens)

---

## Testing Checklist

- [ ] Install dependencies with `npm install`
- [ ] Connect wallet using Freighter extension
- [ ] Verify address displays correctly in navbar
- [ ] Check WalletInfo component shows XLM balance
- [ ] Test disconnect functionality
- [ ] Verify wallet persists after page refresh
- [ ] Test with multiple wallets (LOBSTR, xBull, etc.)
- [ ] Ensure AgentChat can submit queries with connected wallet
- [ ] Verify transaction signing works (if applicable)

---

## Troubleshooting

### Wallet Not Connecting

1. Ensure the wallet extension is installed and unlocked
2. Check browser console for errors
3. Verify you're on TESTNET (not mainnet)

### Balance Not Showing

1. Ensure the server address is a valid Stellar public key
2. Check Horizon API accessibility
3. Verify the account exists on the blockchain

### Modal Not Appearing

1. Clear localStorage and try again
2. Check for JavaScript errors in console
3. Ensure `WalletProvider` wraps your component tree

---

## Migration Benefits

1. **Multi-Wallet Support**: Users can choose their preferred wallet
2. **Better UX**: Unified modal for all wallets
3. **Hardware Wallet Support**: Ledger and Trezor compatible
4. **Future-Proof**: Aligned with Stellar ecosystem standards
5. **Simplified Code**: Single provider pattern instead of Stacks-specific logic

---

## Next Steps

1. ✅ Install Stellar Wallets Kit
2. ✅ Update wallet connection components
3. ✅ Migrate balance fetching to Horizon API
4. ✅ Update environment variables
5. ⏳ Test with multiple wallet providers
6. ⏳ Update documentation for end users
7. ⏳ Consider adding wallet-specific features (e.g., LOBSTR deep linking)

---

## Resources

- [Stellar Wallets Kit Documentation](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [Freighter Wallet](https://www.freighter.app/)
- [Stellar Testnet Guide](https://developers.stellar.org/docs/glossary/testnet/)
