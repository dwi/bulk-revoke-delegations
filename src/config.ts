import { ronin as roninChain } from 'viem/chains'

export const ronin = process.env.RPC_URL
  ? { ...roninChain, rpcUrls: { default: { http: [process.env.RPC_URL] } } }
  : roninChain

export const CONTRACTS = {
  AXIE: '0x32950db2a7164ae833121501c797d79e7b79d74c' as const,
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
  AXIE_DELEGATION: '0xd6d11474eb323521ada927f14a4b839b90009ac8' as const,
}
