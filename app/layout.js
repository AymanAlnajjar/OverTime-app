import "./globals.css";

export const metadata = {
  title: "Overtime Manager — Platinum Group",
  description: "Track, approve, and report overtime hours",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
