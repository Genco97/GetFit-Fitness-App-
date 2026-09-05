import "./globals.css";
import "leaflet/dist/leaflet.css";

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
