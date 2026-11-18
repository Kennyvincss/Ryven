import { getTestUsdcAuthority, serverEnv } from "@/lib/server/env";
import { handler, json } from "@/lib/server/http";
import { APP_NETWORK, publicConfig } from "@/lib/shared/config";

/** Which features are available, for the UI. Public: no secrets, keys, addresses or internals. */
export const GET = handler(async () => {
  let faucet = false;
  try {
    faucet = APP_NETWORK === "devnet" && serverEnv.testUsdcFaucetEnabled && !!getTestUsdcAuthority();
  } catch {}
  return json({
    aiEnabled: !!serverEnv.anthropicApiKey,
    ipfsEnabled: !!serverEnv.pinataJwt,
    testUsdcFaucet: faucet,
    curveProgramId: publicConfig.curveProgramId,
    pumpfunEnabled: process.env.PUMPFUN_ENABLED === "true",
    pumpfunReady: serverEnv.pumpfunEnabled,
    usdcMint: publicConfig.usdcMint,
    cluster: publicConfig.cluster,
    network: APP_NETWORK,
  });
});
