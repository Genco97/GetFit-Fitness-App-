import "./globals.css";

export const metadata = {
  title: "Rig Daily",
  description: "Training, Laufen, Seilspringen — jeder Satz ein Strich.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
