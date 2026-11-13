import type { Metadata, Viewport } from 'next'
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "ValencyStudio File Manager — Secure & Private Cloud Storage",
  description:
    "ValencyStudio File Manager: an enterprise-grade private cloud storage console — encrypted, secure, with share links, previews, and admin analytics.",
  keywords: ["file manager", "secure cloud storage", "private storage", "cloud storage", "file sharing", "ValencyStudio"],
  authors: [{ name: "ValencyStudio" }],
  applicationName: "ValencyStudio File Manager",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ValencyFM",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "ValencyStudio File Manager",
    description: "Private & secure cloud storage — encrypted upload, share, and streaming.",
    siteName: "ValencyStudio File Manager",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
