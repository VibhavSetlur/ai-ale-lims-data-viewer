import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./styles.css";
import { AppShell } from "@/components/app-shell/AppShell";
import { themeInitScript } from "@/components/app-shell/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "AI-ALE Live Research Viewer",
  description: "Explore the AI-ALE adaptive laboratory evolution dataset.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
