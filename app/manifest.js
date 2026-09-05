export default function manifest() {
  return {
    name: "STRADAA",
    short_name: "STRADAA",
    description: "Training, Laufen, Seilspringen — jeder Satz ein Strich.",
    start_url: "/",
    display: "standalone",
    background_color: "#101218",
    theme_color: "#101218",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
