export const CONTRACTS = {
  AXIE: '0x32950db2a7164ae833121501c797d79e7b79d74c' as const,
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
  AXIE_DELEGATION: '0xd6d11474eb323521ada927f14a4b839b90009ac8' as const,
}

export const MULTICALL_BATCH_SIZE = 100
export const REVOKE_BATCH_SIZE = 200

export const erc721Abi = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' }
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

export const axieDelegationAbi = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'isDelegationActive',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'getDelegationInfo',
    outputs: [
      { internalType: 'address', name: 'delegatee', type: 'address' },
      {
        components: [
          { internalType: 'uint64', name: '_delegatedAt', type: 'uint64' },
          { internalType: 'uint64', name: '_expiryTs', type: 'uint64' },
          { internalType: 'uint64', name: '_permissionBitMap', type: 'uint64' }
        ],
        internalType: 'struct IAxieDelegation.DelegationInfo',
        name: 'info',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'bulkRevokeDelegations',
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

export const multicall3Abi = [
  {
    inputs: [
      {
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' }
        ],
        name: 'calls',
        type: 'tuple[]'
      }
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' }
        ],
        name: 'returnData',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const
