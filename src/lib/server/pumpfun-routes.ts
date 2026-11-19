import "server-only";
import { EngineError } from "./engine/payments";
import { serverEnv } from "./env";

export function requirePumpFunEnabled() {
  if (process.env.PUMPFUN_ENABLED !== "true") throw new EngineError("Bonding-curve launches are not available.", 404);
  if (!serverEnv.pinataJwt) throw new EngineError("Bonding-curve launches are temporarily unavailable.", 503);
}
