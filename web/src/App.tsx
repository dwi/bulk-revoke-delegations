import { useState, useCallback, useEffect } from 'react'
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CONTRACTS,
  MULTICALL_BATCH_SIZE,
  REVOKE_BATCH_SIZE,
  erc721Abi,
  axieDelegationAbi,
  multicall3Abi,
} from '@/lib/contracts'

type BatchStatus = 'pending' | 'revoking' | 'confirmed' | 'failed'

interface Batch {
  batchNum: number
  axieIds: bigint[]
  status: BatchStatus
  txHash?: `0x${string}`
  error?: string
}

function chunkIntoBatches(ids: bigint[], size: number): Batch[] {
  const batches: Batch[] = []
  for (let i = 0; i < ids.length; i += size) {
    batches.push({
      batchNum: batches.length + 1,
      axieIds: ids.slice(i, i + size),
      status: 'pending',
    })
  }
  return batches
}

function App() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()

  const [batches, setBatches] = useState<Batch[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchProgress, setFetchProgress] = useState('')
  const [fetched, setFetched] = useState(false)
  const [totalAxies, setTotalAxies] = useState(0)
  const [totalDelegated, setTotalDelegated] = useState(0)
  const [totalActive, setTotalActive] = useState(0)
  const [totalExpired, setTotalExpired] = useState(0)
  const [delegatedIds, setDelegatedIds] = useState<bigint[]>([])
  const [batchSize, setBatchSize] = useState(REVOKE_BATCH_SIZE)
  const [batchSizeInput, setBatchSizeInput] = useState(String(REVOKE_BATCH_SIZE))

  const applyBatchSize = useCallback(() => {
    const parsed = parseInt(batchSizeInput, 10)
    if (isNaN(parsed) || parsed < 1) return
    const clamped = Math.min(Math.max(parsed, 1), 1000)
    setBatchSize(clamped)
    setBatchSizeInput(String(clamped))
    if (delegatedIds.length > 0) {
      setBatches(chunkIntoBatches(delegatedIds, clamped))
    }
  }, [batchSizeInput, delegatedIds])

  const fetchDelegatedAxies = useCallback(async () => {
    if (!address || !publicClient) return

    setFetching(true)
    setFetched(false)
    setBatches([])
    setFetchProgress('Reading Axie balance...')

    try {
      const balance = await publicClient.readContract({
        address: CONTRACTS.AXIE,
        abi: erc721Abi,
        functionName: 'balanceOf',
        args: [address],
      })

      const count = Number(balance)
      setTotalAxies(count)

      if (count === 0) {
        setFetchProgress('')
        setFetching(false)
        setFetched(true)
        return
      }

      setFetchProgress(`Fetching ${count} Axie IDs...`)
      const tokenIds: bigint[] = []

      for (let i = 0; i < count; i += MULTICALL_BATCH_SIZE) {
        const batchSize = Math.min(MULTICALL_BATCH_SIZE, count - i)
        const calls = Array.from({ length: batchSize }, (_, j) => ({
          target: CONTRACTS.AXIE as `0x${string}`,
          allowFailure: false,
          callData: encodeFunctionData({
            abi: erc721Abi,
            functionName: 'tokenOfOwnerByIndex',
            args: [address, BigInt(i + j)],
          }),
        }))

        const results = await publicClient.readContract({
          address: CONTRACTS.MULTICALL3,
          abi: multicall3Abi,
          functionName: 'aggregate3',
          args: [calls],
        })

        for (const result of results) {
          const id = decodeFunctionResult({
            abi: erc721Abi,
            functionName: 'tokenOfOwnerByIndex',
            data: result.returnData,
          })
          tokenIds.push(id)
        }

        setFetchProgress(`Fetched ${tokenIds.length} / ${count} Axie IDs...`)
      }

      setFetchProgress('Checking delegation status...')
      const activeIds: bigint[] = []
      const expiredIds: bigint[] = []
      const now = BigInt(Math.floor(Date.now() / 1000))
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

      for (let i = 0; i < tokenIds.length; i += MULTICALL_BATCH_SIZE) {
        const batch = tokenIds.slice(i, i + MULTICALL_BATCH_SIZE)
        const calls = batch.map((tokenId) => ({
          target: CONTRACTS.AXIE_DELEGATION as `0x${string}`,
          allowFailure: true,
          callData: encodeFunctionData({
            abi: axieDelegationAbi,
            functionName: 'getDelegationInfo',
            args: [tokenId],
          }),
        }))

        const results = await publicClient.readContract({
          address: CONTRACTS.MULTICALL3,
          abi: multicall3Abi,
          functionName: 'aggregate3',
          args: [calls],
        })

        results.forEach((result, j) => {
          if (!result.success) return
          const decoded = decodeFunctionResult({
            abi: axieDelegationAbi,
            functionName: 'getDelegationInfo',
            data: result.returnData,
          }) as readonly [string, { _delegatedAt: bigint; _expiryTs: bigint; _permissionBitMap: bigint }]
          const [delegatee, info] = decoded
          if (delegatee !== ZERO_ADDRESS) {
            if (info._expiryTs > now) {
              activeIds.push(batch[j])
            } else {
              expiredIds.push(batch[j])
            }
          }
        })

        setFetchProgress(`Checked ${Math.min(i + MULTICALL_BATCH_SIZE, tokenIds.length)} / ${tokenIds.length}...`)
      }

      const allDelegatedIds = [...activeIds, ...expiredIds]
      setTotalActive(activeIds.length)
      setTotalExpired(expiredIds.length)
      setTotalDelegated(allDelegatedIds.length)
      setDelegatedIds(allDelegatedIds)

      setBatches(chunkIntoBatches(allDelegatedIds, batchSize))
      setFetchProgress('')
      setFetching(false)
      setFetched(true)
    } catch (err) {
      console.error('Fetch error:', err)
      setFetchProgress(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setFetching(false)
    }
  }, [address, publicClient, batchSize])

  const confirmedCount = batches.filter((b) => b.status === 'confirmed').length

  return (
    <div className="min-h-screen relative">
      {/* Subtle radial glow at top */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.04] rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Bulk Revoke
            </h1>
            <p className="text-xs text-muted-foreground tracking-wide uppercase mt-0.5">
              Axie Delegation Manager
            </p>
          </div>
          <appkit-button size="sm" />
        </header>

        {/* Main action */}
        <div className="mb-6">
          <Button
            className="w-full"
            size="lg"
            onClick={fetchDelegatedAxies}
            disabled={!isConnected || fetching}
          >
            {fetching ? (
              <>
                <Spinner />
                <span>Scanning...</span>
              </>
            ) : (
              'Fetch Delegated Axies'
            )}
          </Button>

          {!isConnected && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Connect your wallet to get started
            </p>
          )}
        </div>

        {/* Progress */}
        {fetchProgress && (
          <div className="mb-6 rounded-lg bg-card border border-border p-3">
            <p className="text-sm text-muted-foreground text-center font-mono animate-progress-pulse">
              {fetchProgress}
            </p>
          </div>
        )}

        {/* Results */}
        {fetched && (
          <div className="space-y-4">
            {/* Stats bar */}
            <div className="flex items-center justify-between rounded-lg bg-card border border-border px-4 py-3">
              <div className="flex items-center gap-4">
                <Stat label="Owned" value={totalAxies} />
                <div className="w-px h-6 bg-border" />
                <Stat label="Active" value={totalActive} accent />
                <div className="w-px h-6 bg-border" />
                <Stat label="Expired" value={totalExpired} warning />
              </div>
              {batches.length > 0 && (
                <span className="text-xs text-muted-foreground font-mono">
                  {confirmedCount}/{batches.length} done
                </span>
              )}
            </div>

            {/* Batch size setting */}
            {totalDelegated > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-3">
                <label className="text-xs text-muted-foreground whitespace-nowrap">
                  Batch size
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={batchSizeInput}
                  onChange={(e) => setBatchSizeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyBatchSize()}
                  className="w-20 h-8 rounded-md bg-muted border border-border px-2 text-sm font-mono text-foreground text-center focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={applyBatchSize}
                  disabled={parseInt(batchSizeInput, 10) === batchSize}
                >
                  Apply
                </Button>
                <span className="text-[11px] text-muted-foreground ml-auto font-mono">
                  {batches.length} batch{batches.length !== 1 ? 'es' : ''}
                </span>
              </div>
            )}

            {batches.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-2xl mb-2 opacity-40">&#10003;</div>
                <p className="text-sm text-muted-foreground">
                  No delegated Axies found
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {batches.map((batch, i) => (
                  <div
                    key={batch.batchNum}
                    className="animate-fade-up"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <BatchCard
                      batch={batch}
                      onStatusChange={(status, txHash, error) => {
                        setBatches((prev) =>
                          prev.map((b) =>
                            b.batchNum === batch.batchNum
                              ? { ...b, status, txHash, error }
                              : b
                          )
                        )
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent, warning }: { label: string; value: number; accent?: boolean; warning?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-semibold font-mono tabular-nums ${warning ? 'text-warning' : accent ? 'text-primary' : 'text-foreground'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  )
}

function BatchCard({
  batch,
  onStatusChange,
}: {
  batch: Batch
  onStatusChange: (status: BatchStatus, txHash?: `0x${string}`, error?: string) => void
}) {
  const { writeContract, data: txHash, isPending } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  useEffect(() => {
    if (isPending && batch.status === 'pending') {
      onStatusChange('revoking')
    }
  }, [isPending, batch.status, onStatusChange])

  useEffect(() => {
    if (txHash && batch.status === 'revoking' && !batch.txHash) {
      onStatusChange('revoking', txHash)
    }
  }, [txHash, batch.status, batch.txHash, onStatusChange])

  useEffect(() => {
    if (isSuccess && batch.status !== 'confirmed') {
      onStatusChange('confirmed', txHash)
    }
  }, [isSuccess, batch.status, txHash, onStatusChange])

  const handleRevoke = () => {
    writeContract(
      {
        address: CONTRACTS.AXIE_DELEGATION,
        abi: axieDelegationAbi,
        functionName: 'bulkRevokeDelegations',
        args: [batch.axieIds],
      },
      {
        onError: (err) => {
          onStatusChange('failed', undefined, err.message)
        },
      }
    )
  }

  const statusBadge = () => {
    switch (batch.status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>
      case 'revoking':
        return <Badge variant="warning">Revoking</Badge>
      case 'confirmed':
        return <Badge variant="success">Revoked</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
    }
  }

  const isActive = batch.status === 'pending' || batch.status === 'failed'
  const cardBorder =
    batch.status === 'confirmed'
      ? 'border-success/20'
      : batch.status === 'failed'
        ? 'border-destructive/20'
        : batch.status === 'revoking'
          ? 'border-warning/20'
          : 'border-border'

  return (
    <div className={`rounded-xl bg-card border ${cardBorder} p-4 transition-colors duration-300`}>
      {/* Top row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">Batch {batch.batchNum}</span>
          <span className="text-xs text-muted-foreground font-mono">
            {batch.axieIds.length} axies
          </span>
        </div>
        {statusBadge()}
      </div>

      {/* Tx hash */}
      {batch.txHash && (
        <div className="mb-3 rounded-md bg-muted/50 px-3 py-2">
          <p className="text-[11px] text-muted-foreground font-mono break-all leading-relaxed">
            {batch.txHash}
          </p>
        </div>
      )}

      {/* Error */}
      {batch.error && (
        <div className="mb-3 rounded-md bg-destructive/5 border border-destructive/10 px-3 py-2">
          <p className="text-[11px] text-destructive font-mono break-all leading-relaxed">
            {batch.error}
          </p>
        </div>
      )}

      {/* Action */}
      {batch.status === 'pending' && (
        <Button
          className="w-full"
          size="lg"
          variant="destructive"
          onClick={handleRevoke}
          disabled={isPending}
        >
          Revoke {batch.axieIds.length} Delegations
        </Button>
      )}

      {(batch.status === 'revoking' || isConfirming) && (
        <Button className="w-full" size="lg" variant="outline" disabled>
          <Spinner />
          {isConfirming ? 'Confirming...' : 'Waiting for wallet...'}
        </Button>
      )}

      {batch.status === 'failed' && !isActive ? null : batch.status === 'failed' && (
        <Button
          className="w-full"
          size="lg"
          variant="destructive"
          onClick={handleRevoke}
        >
          Retry
        </Button>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export default App
