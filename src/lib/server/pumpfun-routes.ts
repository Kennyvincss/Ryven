import "server-only";
import { EngineError } from "./engine/payments";
import { serverEnv } from "./env";

export function requirePumpFunEnabled() {
  if (process.env.PUMPFUN_ENABLED !== "true") throw new EngineError("pump.fun launches are not enabled on this deployment (PUMPFUN_ENABLED).", 404);
  if (!serverEnv.pinataJwt) throw new EngineError("pump.fun launches need IPFS metadata: set PINATA_JWT (free key at app.pinata.cloud).", 503);
}
