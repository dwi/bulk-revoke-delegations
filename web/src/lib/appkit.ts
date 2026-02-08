import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { createAppKit } from '@reown/appkit/react'
import { ronin } from '@reown/appkit/networks'
import { http } from 'viem'

const projectId = 'b87d91b847cc0d3656947c1d5334f564'
const rpcUrl = import.meta.env.VITE_RPC_URL || 'https://api.roninchain.com/rpc'

export const wagmiAdapter = new WagmiAdapter({
  networks: [ronin],
  projectId,
  transports: { [ronin.id]: http(rpcUrl) },
})

createAppKit({
  adapters: [wagmiAdapter],
  networks: [ronin],
  projectId,
  metadata: {
    name: 'Bulk Revoke Delegation',
    description: 'Revoke Axie delegations in bulk',
    url: typeof window !== 'undefined' ? window.location.origin : '',
    icons: [],
  },
  featuredWalletIds: [
    '541d5dcd4ede02f3afaf75bf8e3e4c4f1fb09edb5fa6c4377ebf31c2785d9adf', // Ronin Wallet
  ],
})
