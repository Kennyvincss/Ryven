import { getFeePayer, getTestUsdcAuthority, serverEnv } from "@/lib/server/env";
import { handler, json } from "@/lib/server/http";
import { publicConfig } from "@/lib/shared/config";

/** Tells the UI which optional integrations are configured (no secrets). */
export const GET = handler(async () => {
  let feePayer: string | null = null;
  try {
    feePayer = getFeePayer().publicKey.toBase58();
  } catch {}
  let faucet = false;
  try {
    faucet = serverEnv.testUsdcFaucetEnabled && !!getTestUsdcAuthority();
  } catch {}
  return json({
    aiEnabled: !!serverEnv.anthropicApiKey,
    aiModel: serverEnv.anthropicApiKey ? serverEnv.anthropicModel : null,
    ipfsEnabled: !!serverEnv.pinataJwt,
    feePayer,
    testUsdcFaucet: faucet,
    curveProgramId: publicConfig.curveProgramId,
    pumpfunEnabled: process.env.PUMPFUN_ENABLED === "true",
    pumpfunReady: serverEnv.pumpfunEnabled,
    usdcMint: publicConfig.usdcMint,
    cluster: publicConfig.cluster,
  });
});
