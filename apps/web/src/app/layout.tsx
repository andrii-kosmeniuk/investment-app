import type { Metadata } from "next";
import "@corgi/ui/tokens.css";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "Corgi Invest",
    template: "%s · Corgi Invest",
  },
  description: "A transparent model-portfolio investing experience.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
