import type { Metadata } from "next";
import "./globals.css";
import AppInstall from "@/components/app-install";
export const metadata: Metadata = {
  title: "FormSync AI | Training workspace",
  description:
    "Review your movement, measure your form, and track every practice session.",
  icons: { icon: "/favicon.svg" },
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
