import type { Metadata } from "next";
import "./globals.css";
import AppInstall from "@/components/app-install";
export const metadata: Metadata = {
  title: "FormSync AI | Training workspace",
  description:
    "Review your movement, measure your form, and track every practice session.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/brand/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/icon-48.png", type: "image/png", sizes: "48x48" },
    ],
    apple: [{ url: "/brand/icon-180.png", sizes: "180x180" }],
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <AppInstall />
      </body>
    </html>
  );
}
