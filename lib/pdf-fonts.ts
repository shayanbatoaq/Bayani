import path from "node:path"
import { Font } from "@react-pdf/renderer"

/* Caladea is metric-compatible with Cambria; Carlito with Calibri. Both OFL, bundled in assets/fonts. */
const fontDir = path.join(/* turbopackIgnore: true */ process.cwd(), "assets", "fonts")
Font.register({
  family: "Serif",
  fonts: [
    { src: path.join(fontDir, "Caladea-Regular.ttf") },
    { src: path.join(fontDir, "Caladea-Bold.ttf"), fontWeight: "bold" },
    { src: path.join(fontDir, "Caladea-Italic.ttf"), fontStyle: "italic" },
    { src: path.join(fontDir, "Caladea-BoldItalic.ttf"), fontWeight: "bold", fontStyle: "italic" },
  ],
})
Font.register({
  family: "Sans",
  fonts: [
    { src: path.join(fontDir, "Carlito-Regular.ttf") },
    { src: path.join(fontDir, "Carlito-Bold.ttf"), fontWeight: "bold" },
  ],
})
Font.registerHyphenationCallback((word) => [word])
