// Diagonal stripe overlay pattern, used for the Topps trading-card texture
// on colored panels (GM nameplate, director identity bars).
//
// Apply with:
//   backgroundColor: "#E8503A",
//   backgroundImage: diagonalStripes("rgba(255,255,255,0.12)"),
//
// Use backgroundColor + backgroundImage separately, NOT the `background`
// shorthand — shorthand resets backgroundImage.

export function diagonalStripes(stripeColor: string): string {
  return `repeating-linear-gradient(135deg, transparent 0 18px, ${stripeColor} 18px 21px)`;
}