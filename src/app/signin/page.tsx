"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInPanel } from "@/components/sign-in-panel";
import { useSession } from "@/lib/client/session";

/** Only same-site paths are allowed as a return address. */
function safeNext(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/dashboard";
}

function SignIn() {
  const { authed } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  useEffect(() => {
    if (authed) router.replace(next);
  }, [authed, next, router]);
  return <SignInPanel />;
}

export default function SignInPage() {
  return (
    <div className="px-3 py-8 sm:px-6 sm:py-12">
      <h1 className="sr-only">Sign in to Ryven</h1>
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
