import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Footer, Navbar } from "@/components/site-chrome";

export const metadata: Metadata = {
  title: { default: "Ryyven: Memecoin Terminal · AI", template: "%s · Ryyven" },
  description: "Launch tokens, deploy autonomous AI agents with their own treasuries, and run self-operating economies on Solana.",
};

export const viewport: Viewport = { themeColor: "#0a0c0f", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
