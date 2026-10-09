// Four concepts. Each returns SVG inner markup for a 64x64 box, drawn in `fg`.
const marks = {
  // A. Split Second: a disc cut in half, the right half lifted. The instant something is pulled up.
  split: (fg) => `
    <path d="M32 8 A24 24 0 0 0 32 56 Z" fill="${fg}"/>
    <path d="M35 3 A24 24 0 0 1 35 51 Z" fill="${fg}"/>`,
  // B. Rebound: a line falls, touches bottom, springs back higher than it started. Dot marks the instant.
  rebound: (fg) => `
    <path d="M10 22 C18 28 22 46 30 46 C38 46 44 30 54 14" fill="none" stroke="${fg}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="30" cy="46" r="0.1" fill="${fg}"/>`,
  // C. Tide S: two stacked half-rings form an S, offset like a wave. One stroke weight.
  tide: (fg) => `
    <path d="M44 14 A12 12 0 0 0 32 10 A11 11 0 0 0 32 32 A11 11 0 0 1 32 54 A12 12 0 0 1 20 50" fill="none" stroke="${fg}" stroke-width="7" stroke-linecap="round"/>`,
  // D. Moment: a ring with a single cut; the cut is the instant.
  moment: (fg) => `
    <path d="M44.7 13.6 A22 22 0 1 0 53.4 25" fill="none" stroke="${fg}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="53" cy="13" r="4.2" fill="${fg}"/>`,
};
if (typeof module !== 'undefined') module.exports = marks;
