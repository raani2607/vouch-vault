import type { Metadata } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "VouchVault | Verifiable Growth Capital & Attention Treasuries",
  description:
    "VouchVault fixed-supply token lifecycle, vesting, and deterministic growth treasury architecture on Solana.",
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
