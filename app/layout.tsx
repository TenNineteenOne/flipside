import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Two families only: Familjen Grotesk for all text, Martian Mono for hints, durations and counts.
// `subsets` only picks what is preloaded: every subset's @font-face is still declared, and the browser
// fetches latin-ext (or Martian Mono) by unicode-range when a page uses it. So only Familjen Grotesk
// latin is preloaded; Martian Mono (small hints and counts) loads on use, with metric-matched fallbacks.
const sans = Familjen_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const mono = Martian_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#121015" },
    { media: "(prefers-color-scheme: light)", color: "#121015" },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Flipside",
    template: "%s · Flipside",
  },
  description: "Great music is waiting to find you.",
  applicationName: "Flipside",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: "Flipside",
    title: "Flipside",
    description: "Great music is waiting to find you.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Flipside",
    description: "Great music is waiting to find you.",
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    title: "Flipside",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Toaster theme="dark" position="bottom-center" />
        {children}
      </body>
    </html>
  );
}
