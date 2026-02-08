#!/usr/bin/env bun

import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'
import type { Address } from 'viem'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { publicClient, sourceAccount, sourceWalletClient } from './clients.js'
import { erc721Abi, axieDelegationAbi, multicall3Abi } from './contracts/abis.js'
import { CONTRACTS } from './config.js'

const MULTICALL_BATCH_SIZE = 100
const REVOKE_BATCH_SIZE = 100

async function getEIP1559Fees() {
  const [block, rpcPriorityFee, legacyGasPrice] = await Promise.all([
    publicClient.getBlock({ blockTag: 'latest' }),
    publicClient.estimateMaxPriorityFeePerGas(),
    publicClient.getGasPrice()
  ])

  const baseFee = block.baseFeePerGas ?? 0n
  const maxPriorityFeePerGas = (rpcPriorityFee * 200n) / 100n
  let maxFeePerGas = (baseFee * 2n) + maxPriorityFeePerGas
  if (maxFeePerGas < legacyGasPrice) {
    maxFeePerGas = legacyGasPrice
  }

  return { maxFeePerGas, maxPriorityFeePerGas }
}

async function main() {
  console.log('Bulk Revoke Delegations')
  console.log('=======================')
  console.log(`Wallet: ${sourceAccount.address}\n`)

  // Step 1: Fetch all Axie token IDs
  console.log('Fetching Axies...')
  const balance = await publicClient.readContract({
    address: CONTRACTS.AXIE,
    abi: erc721Abi,
    functionName: 'balanceOf',
    args: [sourceAccount.address]
  })

  const totalAxies = Number(balance)
  if (totalAxies === 0) {
    console.log('  No Axies found.')
    return
  }

  const allAxieIds: bigint[] = []
  for (let i = 0; i < totalAxies; i += MULTICALL_BATCH_SIZE) {
    const batchEnd = Math.min(i + MULTICALL_BATCH_SIZE, totalAxies)

    const calls = []
    for (let j = i; j < batchEnd; j++) {
      calls.push({
        target: CONTRACTS.AXIE as Address,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: erc721Abi,
          functionName: 'tokenOfOwnerByIndex',
          args: [sourceAccount.address, BigInt(j)]
        })
      })
    }

    const results = await publicClient.readContract({
      address: CONTRACTS.MULTICALL3,
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls]
    }) as readonly { success: boolean; returnData: `0x${string}` }[]

    for (let j = 0; j < batchEnd - i; j++) {
      if (results[j].success) {
        const tokenId = decodeFunctionResult({
          abi: erc721Abi,
          functionName: 'tokenOfOwnerByIndex',
          data: results[j].returnData
        }) as bigint
        allAxieIds.push(tokenId)
      }
    }
  }

  console.log(`  Found ${allAxieIds.length} Axies\n`)

  // Step 2: Check delegation info for all Axies
  console.log('Checking delegation status...')
  const activeAxies: bigint[] = []
  const expiredAxies: bigint[] = []
  const now = BigInt(Math.floor(Date.now() / 1000))
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  for (let i = 0; i < allAxieIds.length; i += MULTICALL_BATCH_SIZE) {
    const batch = allAxieIds.slice(i, i + MULTICALL_BATCH_SIZE)

    const calls = batch.map(tokenId => ({
      target: CONTRACTS.AXIE_DELEGATION as Address,
      allowFailure: true,
      callData: encodeFunctionData({
        abi: axieDelegationAbi,
        functionName: 'getDelegationInfo',
        args: [tokenId]
      })
    }))

    const results = await publicClient.readContract({
      address: CONTRACTS.MULTICALL3,
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls]
    }) as readonly { success: boolean; returnData: `0x${string}` }[]

    for (let j = 0; j < batch.length; j++) {
      if (results[j].success) {
        const [delegatee, info] = decodeFunctionResult({
          abi: axieDelegationAbi,
          functionName: 'getDelegationInfo',
          data: results[j].returnData
        }) as readonly [string, { _delegatedAt: bigint; _expiryTs: bigint; _permissionBitMap: bigint }]

        if (delegatee !== ZERO_ADDRESS) {
          if (info._expiryTs > now) {
            activeAxies.push(batch[j])
          } else {
            expiredAxies.push(batch[j])
          }
        }
      }
    }

    const checked = Math.min(i + MULTICALL_BATCH_SIZE, allAxieIds.length)
    console.log(`  Checked ${checked}/${allAxieIds.length}...`)
  }

  const delegatedAxies = [...activeAxies, ...expiredAxies]
  console.log(`  Found ${delegatedAxies.length} delegated Axies (${activeAxies.length} active, ${expiredAxies.length} expired)\n`)

  if (delegatedAxies.length === 0) {
    console.log('Done. No delegations to revoke.')
    return
  }

  // Step 3: Write delegated Axie IDs to file
  const filePath = join(process.cwd(), 'delegated_axies.txt')
  writeFileSync(filePath, delegatedAxies.map(String).join('\n') + '\n')
  console.log(`Saved ${delegatedAxies.length} delegated Axie IDs to delegated_axies.txt`)
  console.log('You may edit the file to remove Axies you want to keep delegated.\n')

  // Step 4: Confirm before revoking
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>(resolve => {
    rl.question('Proceed with revocation? (Y/n) ', resolve)
  })
  rl.close()

  if (answer.toLowerCase() === 'n') {
    console.log('Aborted.')
    return
  }

  // Step 5: Re-read file (user may have edited it)
  const fileContent = readFileSync(filePath, 'utf-8')
  const axieIdsToRevoke = fileContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(BigInt)

  console.log(`\nRead ${axieIdsToRevoke.length} Axie IDs from delegated_axies.txt`)

  if (axieIdsToRevoke.length === 0) {
    console.log('Done. No Axies to revoke.')
    return
  }

  // Step 6: Revoke in batches of 100
  const totalBatches = Math.ceil(axieIdsToRevoke.length / REVOKE_BATCH_SIZE)

  for (let i = 0; i < axieIdsToRevoke.length; i += REVOKE_BATCH_SIZE) {
    const batch = axieIdsToRevoke.slice(i, i + REVOKE_BATCH_SIZE)
    const batchNum = Math.floor(i / REVOKE_BATCH_SIZE) + 1

    console.log(`Revoking delegations (batch ${batchNum}/${totalBatches}, ${batch.length} Axies)...`)

    const { maxFeePerGas, maxPriorityFeePerGas } = await getEIP1559Fees()

    const hash = await sourceWalletClient.writeContract({
      address: CONTRACTS.AXIE_DELEGATION,
      abi: axieDelegationAbi,
      functionName: 'bulkRevokeDelegations',
      args: [batch],
      maxFeePerGas,
      maxPriorityFeePerGas
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(`  Tx: ${hash}  ✓ confirmed (block ${receipt.blockNumber})`)
  }

  console.log(`\nDone. Revoked ${axieIdsToRevoke.length} delegations.`)
}

main().catch(error => {
  console.error('\nError:', error)
  process.exit(1)
})
