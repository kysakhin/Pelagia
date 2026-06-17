import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Navbar from "@/components/Navbar";
import UserSync from "@/components/UserSync";
import "./globals.css";

export const metadata: Metadata = {
  title: "OceoGeo",
  description: "A Oceonographic data visualization tool built with Next.js and React.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <UserSync />
          <Navbar />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
