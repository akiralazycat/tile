import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tile — Web to Widget",
  description: "Turn almost any website, RSS, Atom, or JSON Feed into a glanceable widget recipe.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f10",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
