import type { Ethereum } from "@metamask/providers";

declare global {
  interface Window {
    ethereum?: Ethereum;
  }
}
