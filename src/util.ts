import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { PriorityFee, TransactionResult, feeOptions } from "./types";

export const DEFAULT_COMMITMENT: Commitment = "finalized";
export const DEFAULT_FINALITY: Finality = "finalized";

export const calculateWithSlippageBuy = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount + (amount * basisPoints) / 10000n;
};

export const calculateWithSlippageSell = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount - (amount * basisPoints) / 10000n;
};

export async function sendTx(
  connection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY,
  feeOptions?: feeOptions,
  priorityFees?: PriorityFee,
): Promise<TransactionResult> {
  let newTx = new Transaction();

  if (priorityFees) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: priorityFees.unitLimit,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFees.unitPrice,
    });
    newTx.add(modifyComputeUnits);
    newTx.add(addPriorityFee);
  }

  newTx.add(tx);

  if (feeOptions) {
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: feeOptions.feeReciever!,
      lamports: feeOptions.feeAmount!,
    });
    newTx.add(transferInstruction);
  }

  let versionedTx = await buildVersionedTx(connection, payer, newTx, commitment);
  versionedTx.sign(signers);

  try {
    const sig = await connection.sendTransaction(versionedTx, {
      skipPreflight: false,
    });
    let txResult = await getTxDetails(connection, sig, commitment, finality);
    if (!txResult) {
      return {
        success: false,
        error: "Transaction failed",
      };
    }
    console.log("sig:", `https://solscan.io/tx/${sig}`);
    return {
      success: true,
      signature: sig,
      results: txResult,
    };
  } catch (e) {
    if (e instanceof SendTransactionError) {
      let ste = e as SendTransactionError;
      console.log("SendTransactionError" + await ste.getLogs(connection));
    } else {
      console.error(e);
    }
    return {
      error: e,
      success: false,
    };
  }
}

export const buildVersionedTx = async (
  connection: Connection,
  payer: PublicKey,
  tx: Transaction,
  commitment: Commitment = DEFAULT_COMMITMENT
): Promise<VersionedTransaction> => {
  const blockHash = (await connection.getLatestBlockhash(commitment))
    .blockhash;

  let messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockHash,
    instructions: tx.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
};

export const getTxDetails = async (
  connection: Connection,
  sig: string,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY
): Promise<VersionedTransactionResponse | null> => {
  const latestBlockHash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    {
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: sig,
    },
    commitment
  );

  return connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: finality,
  });
};
