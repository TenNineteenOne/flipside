import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic", "normal"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#0a0a0a" },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Flipside",
    template: "%s · Flipside",
  },
  description: "Music discovery, without the strings.",
  applicationName: "Flipside",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: "Flipside",
    title: "Flipside",
    description: "Music discovery, without the strings.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Flipside",
    description: "Music discovery, without the strings.",
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
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @supports ((backdrop-filter: blur(30px)) or (-webkit-backdrop-filter: blur(30px))) {
                .fs-card { backdrop-filter: blur(30px) saturate(1.1); -webkit-backdrop-filter: blur(30px) saturate(1.1); }
                .appnav { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
              }
            `,
          }}
        />
        <Toaster theme="dark" position="bottom-center" />
        {children}
      </body>
    </html>
  );
}
