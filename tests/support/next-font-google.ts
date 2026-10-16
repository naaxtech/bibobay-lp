// Vitest stand-in for next/font/google. The real loaders only exist inside Next's compiler
// (`next dev` / `next build`); outside it the module exports nothing callable. The stand-in
// echoes the requested CSS variable name so tests can assert how the layout wires the fonts.

interface FontOptions {
  variable?: string;
}

function loader(options: FontOptions = {}) {
  return { className: "", style: { fontFamily: "" }, variable: options.variable ?? "" };
}

export const Fredoka = loader;
export const Plus_Jakarta_Sans = loader;
