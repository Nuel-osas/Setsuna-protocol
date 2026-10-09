const L = 'M32 8 A24 24 0 0 0 32 56 C24 44 40 20 32 8 Z';
const R = 'M32 8 C40 20 24 44 32 56 A24 24 0 0 0 32 8 Z';
const finals = {
  // A1: straight cut, decisive lift
  lift: (fg) => `<g transform="translate(0 3.5)">
    <path d="M30.5 8 A24 24 0 0 0 30.5 56 Z" fill="${fg}"/>
    <path d="M33.5 0 A24 24 0 0 1 33.5 48 Z" fill="${fg}"/></g>`,
  // A2: wave cut, right half lifted. Split-second + the wave from the reference.
  wave: (fg) => `<g transform="translate(0 3)">
    <path d="${L}" transform="translate(-1.7 0)" fill="${fg}"/>
    <path d="${R}" transform="translate(1.7 -6)" fill="${fg}"/></g>`,
};
if (typeof module !== 'undefined') module.exports = finals;
