// Re-export wallet utilities from WalletProvider for backward compatibility
// New code should use the useWallet hook directly

export { useWallet } from './WalletProvider';
export type { WalletContextType } from './WalletProvider';

/**
 * @deprecated Use useWallet hook instead
 * This file is kept for backward compatibility during migration
 */
export const userSession = null;

export function authenticate() {
  console.warn('authenticate() is deprecated. Use the useWallet hook instead.');
}

export function getUserData() {
  console.warn('getUserData() is deprecated. Use the useWallet hook instead.');
  return null;
}

export function sign_out() {
  console.warn('sign_out() is deprecated. Use the disconnect method from useWallet hook instead.');
}
