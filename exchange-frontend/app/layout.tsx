import "./globals.css";
import { Inter } from "next/font/google";
import { Appbar } from "./components/Appbar";

<<<<<<< Updated upstream
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Exchange ",
  description: "My Exchange App",
};

=======
>>>>>>> Stashed changes
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
<<<<<<< Updated upstream
      <body
        className={inter.className}>
          <Appbar />
        {children}
      </body>
=======
      <body>{children}</body>
>>>>>>> Stashed changes
    </html>
  );
}
