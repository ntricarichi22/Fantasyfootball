import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CFC — Cleveland Football Club",
  description: "Cleveland Football Club fantasy football command center.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700;800&family=Syne:wght@700;800&display=swap"
        />
      </head>
      <body className="antialiased bg-[var(--cfc-canvas)] text-[var(--cfc-ink)]">
        {children}
      </body>
    </html>
  );
}
