/**
 * Token launch (browser): a single creator-signed Token-2022 transaction that
 *  1. creates the mint with the MetadataPointer extension (metadata lives on the mint)
 *  2. initializes the mint (6 decimals) and its on-chain TokenMetadata (name/symbol/uri)
 *  3. mints the fixed initial supply to the creator
 *  4. permanently revokes the mint authority (no one can ever mint more)
 */
import {
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import { type Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { LAUNCH_TOKEN_DECIMALS } from "../shared/config";

export const TOKEN_LIMITS = { name: 32, symbol: 10, uri: 200 };

export async function buildLaunchTransaction(args: {
  connection: Connection;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  supply: bigint; // base units
}): Promise<{ tx: Transaction; mint: Keypair }> {
  const mint = Keypair.generate();
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: args.name,
    symbol: args.symbol,
    uri: args.uri,
    additionalMetadata: [],
    updateAuthority: args.creator,
  };
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await args.connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);
  const ata = getAssociatedTokenAddressSync(mint.publicKey, args.creator, false, TOKEN_2022_PROGRAM_ID);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: args.creator,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(mint.publicKey, args.creator, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, LAUNCH_TOKEN_DECIMALS, args.creator, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint.publicKey,
      updateAuthority: args.creator,
      mint: mint.publicKey,
      mintAuthority: args.creator,
      name: args.name,
      symbol: args.symbol,
      uri: args.uri,
    }),
    createAssociatedTokenAccountIdempotentInstruction(args.creator, ata, args.creator, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint.publicKey, ata, args.creator, args.supply, [], TOKEN_2022_PROGRAM_ID),
    createSetAuthorityInstruction(mint.publicKey, args.creator, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
  );
  tx.feePayer = args.creator;
  return { tx, mint };
}
