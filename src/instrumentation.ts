/**
 * Runs once when the server starts. In development (or when AUTO_MIGRATE=true) it
 * applies pending database migrations, so `git pull` + `npm run dev` never leaves the
 * database behind the code. Set AUTO_MIGRATE=false to turn this off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
