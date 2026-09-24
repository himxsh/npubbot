import { Wallet } from "@cashu/cashu-ts";

export type CashuHandle =
  | { mock: true; mintUrl: null; wallet: null }
  | { mock: false; mintUrl: string; wallet: Wallet };

/**
 * TODO(cashu-mint): Replace this handle with a real wallet:
 *   const wallet = new Wallet(mintUrl);
 *   await wallet.loadMint();
 * Then: receive tokens for admission, persist proofs (never log them),
 * and melt to Lightning when the tool spender needs to pay.
 */
export function createCashuHandle(
  mintUrl: string | undefined,
  mock: boolean,
): CashuHandle {
  if (mock || mintUrl === undefined) {
    console.info("[cashu] mock wallet — not contacting a mint");
    return { mock: true, mintUrl: null, wallet: null };
  }

  const wallet = new Wallet(mintUrl);
  console.info(
    `[cashu] TODO(cashu-mint): wallet.loadMint() against ${mintUrl}`,
  );
  return { mock: false, mintUrl, wallet };
}
