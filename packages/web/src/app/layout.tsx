import type { Metadata } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "ATTENZA | Startup Attention Marketplace",
  description:
    "ATTENZA fixed-supply token lifecycle and vesting demonstration on Solana Devnet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
