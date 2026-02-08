import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ronin } from './config.js'

if (!process.env.PRIVATE_KEY) {
  console.error('Error: PRIVATE_KEY environment variable is required')
  console.error('Create a .env file with: PRIVATE_KEY=0x...')
  process.exit(1)
}

export const sourceAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)

export const publicClient = createPublicClient({
  chain: ronin,
  transport: http()
})

export const sourceWalletClient = createWalletClient({
  account: sourceAccount,
  chain: ronin,
  transport: http()
})
