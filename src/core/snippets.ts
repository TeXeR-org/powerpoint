import { RenderMode } from "./types";

export interface Snippet {
  id: string;
  label: string;
  hint: string;
  mode: RenderMode;
  workspace: "math" | "latex" | "tikz";
  source: string;
}

export const SNIPPETS: Snippet[] = [
  {
    id: "integral",
    label: "Integral",
    hint: "Quick",
    mode: "quick",
    workspace: "math",
    source: "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
  },
  {
    id: "matrix",
    label: "Matrix",
    hint: "Quick",
    mode: "quick",
    workspace: "math",
    source:
      "\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}\n\\begin{pmatrix} x \\\\ y \\end{pmatrix}\n=\n\\begin{pmatrix} ax+by \\\\ cx+dy \\end{pmatrix}",
  },
  {
    id: "align",
    label: "Aligned steps",
    hint: "Quick",
    mode: "quick",
    workspace: "math",
    source:
      "\\begin{aligned}\n  (a+b)^2\n    &= (a+b)(a+b) \\\\\n    &= a^2 + 2ab + b^2\n\\end{aligned}",
  },
  {
    id: "tikz-arrow",
    label: "TikZ arrow",
    hint: "Local TeX",
    mode: "full",
    workspace: "tikz",
    source:
      "\\usetikzlibrary{arrows.meta,positioning}\n\\begin{tikzpicture}[node distance=2.2cm, auto]\n  \\node (A) {$A$};\n  \\node (B) [right=of A] {$B$};\n  \\draw[->] (A) -- node {$f$} (B);\n\\end{tikzpicture}",
  },
  {
    id: "commutative",
    label: "Comm. square",
    hint: "Full",
    mode: "full",
    workspace: "tikz",
    source:
      "\\usetikzlibrary{matrix,arrows.meta}\n\\begin{tikzpicture}\n  \\matrix (m) [matrix of math nodes, row sep=2em, column sep=2.5em]\n    { A & B \\\\\n      C & D \\\\};\n  \\draw[-{Stealth}] (m-1-1) -- node[above] {$f$} (m-1-2);\n  \\draw[-{Stealth}] (m-1-1) -- node[left] {$g$} (m-2-1);\n  \\draw[-{Stealth}] (m-1-2) -- node[right] {$h$} (m-2-2);\n  \\draw[-{Stealth}] (m-2-1) -- node[below] {$k$} (m-2-2);\n\\end{tikzpicture}",
  },
  {
    id: "circuit",
    label: "Circuit",
    hint: "circuitikz",
    mode: "full",
    workspace: "tikz",
    source:
      "\\usepackage{circuitikz}\n\\begin{circuitikz}[american]\n  \\draw (0,0) to[V, v=$V$] (0,2)\n        to[R, l=$R$] (3,2)\n        to[C, l=$C$] (3,0)\n        -- (0,0);\n\\end{circuitikz}",
  },
  {
    id: "chemfig",
    label: "Molecule",
    hint: "chemfig",
    mode: "full",
    workspace: "latex",
    source:
      "\\usepackage{chemfig}\n\\chemfig{H-C(-[2]H)(-[6]H)-C(-[2]H)(-[6]H)-OH}",
  },
  {
    id: "pgfplots",
    label: "Plot",
    hint: "pgfplots",
    mode: "full",
    workspace: "tikz",
    source:
      "\\usepackage{pgfplots}\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n\\begin{axis}[width=8cm, height=5cm, xlabel={$x$}, ylabel={$y$}, grid=major]\n  \\addplot[domain=-2:2, samples=80] {x^2};\n\\end{axis}\n\\end{tikzpicture}",
  },
];

const FULL_HINT =
  /\\begin\{(tikzpicture|circuitikz|chemfig|forest|axis)\}|\\documentclass|\\usepackage\{|\\usetikzlibrary|\\tikzset|\\draw\b|\\node\b/;

/** True when the source almost certainly needs a real TeX engine, not MathJax. */
export function looksLikeFullLatex(source: string): boolean {
  return FULL_HINT.test(source);
}
