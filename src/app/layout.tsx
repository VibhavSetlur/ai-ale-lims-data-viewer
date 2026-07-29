import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AI-ALE Live Research Viewer",
  description: "Foundation for the next AI-ALE research viewer.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
