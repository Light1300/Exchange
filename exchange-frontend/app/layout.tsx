import "./globals.css";
import { Inter } from "next/font/google";
import { Appbar } from "./components/Appbar";
import { Metadata } from "next";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Exchange ",
  description: "My Exchange App",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={inter.className}>
          <Appbar />
        {children}
      </body>
    </html>
  );
}
