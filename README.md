# Bulk Revoke Delegation

**Web App: [bulk-revoke-delegations.vercel.app](https://bulk-revoke-delegations.vercel.app)**

Bulk revoke delegations on all delegated Axies owned by a wallet.

## Setup

```sh
bun install
cp .env.example .env
```

Set `PRIVATE_KEY` in `.env` to your wallet's private key (0x-prefixed).

Optionally set `RPC_URL` to override the default Ronin RPC.

## Usage

```sh
bun start
```

The script will:

1. Fetch all Axies owned by the wallet
2. Check which ones have active delegations
3. Write delegated Axie IDs to `delegated_axies.txt`
4. Prompt for confirmation — you can edit the file before confirming to skip specific Axies
5. Revoke delegations in batches of 100
