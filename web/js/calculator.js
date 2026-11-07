// Modo camaleón: calculadora científica real (analizador descendente recursivo, sin eval).
const KEYS = [
  ['sin', 'fn'], ['cos', 'fn'], ['tan', 'fn'], ['√', 'fn'], ['C', 'fn'],
  ['π', 'fn'], ['x²', 'fn'], ['(', 'fn'], [')', 'fn'], ['⌫', 'fn'],
  ['7'], ['8'], ['9'], ['÷', 'fn'], ['%', 'fn'],
  ['4'], ['5'], ['6'], ['×', 'fn'], ['^', 'fn'],
  ['1'], ['2'], ['3'], ['−', 'fn'], ['ln', 'fn'],
  ['±', 'fn'], ['0'], ['.'], ['+', 'fn'], ['=', 'eq'],
];

function evaluate(src) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, `(${Math.PI})`).replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const eat = (c) => { if (s[i] === c) { i++; return true; } return false; };
  const fns = { sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), '√': Math.sqrt, ln: Math.log };
  function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
  function term() { let v = power(); for (;;) { if (eat('*')) v *= power(); else if (eat('/')) v /= power(); else if (eat('%')) v %= power(); else return v; } }
  function power() { const b = unary(); return eat('^') ? Math.pow(b, power()) : b; }
  function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return postfix(); }
  function postfix() { let v = atom(); while (eat('²')) v *= v; return v; }
  function atom() {
    for (const name of Object.keys(fns)) {
      if (s.startsWith(name, i)) { i += name.length; return fns[name](eat('(') ? closeParen(expr()) : atom()); }
    }
    if (eat('(')) return closeParen(expr());
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('sintaxis');
    i += m[0].length; return parseFloat(m[0]);
  }
  function closeParen(v) { eat(')'); return v; }
  const v = expr();
  if (i < s.length || !Number.isFinite(v)) throw new Error('sintaxis');
  return +v.toPrecision(12);
}

export class Calculator {
  constructor(root, { onExit, checkPin }) {
    this.root = root; this.onExit = onExit; this.checkPin = checkPin;
    this.expr = ''; this.out = '0';
    const keys = root.querySelector('#calc-keys');
    keys.innerHTML = KEYS.map(([k, c]) => `<button class="${c || ''}" data-k="${k}">${k}</button>`).join('');
    keys.addEventListener('click', (e) => { const k = e.target.dataset.k; if (k && !this.longFired) this.press(k); this.longFired = false; });
    const eq = keys.querySelector('[data-k="="]');
    const startLong = () => { this.longTimer = setTimeout(() => { this.longFired = true; this.tryExit(); }, 1000); };
    const endLong = () => clearTimeout(this.longTimer);
    eq.addEventListener('pointerdown', startLong);
    ['pointerup', 'pointerleave'].forEach((ev) => eq.addEventListener(ev, endLong));
    this.onKey = (e) => {
      if (this.root.hidden) return;
      const map = { '*': '×', '/': '÷', '-': '−', Enter: '=', Backspace: '⌫', Escape: 'C' };
      const k = map[e.key] || e.key;
      if (/^[0-9.+()%^]$/.test(k) || ['×', '÷', '−', '=', '⌫', 'C'].includes(k)) { e.preventDefault(); e.stopPropagation(); this.press(k); }
    };
    window.addEventListener('keydown', this.onKey, true);
  }

  async tryExit() {
    const typed = this.expr.replace(/\D/g, '');
    if (await this.checkPin(typed)) { this.expr = ''; this.out = '0'; this.render(); this.onExit(); }
  }

  press(k) {
    if (k === 'C') { this.expr = ''; this.out = '0'; }
    else if (k === '⌫') this.expr = this.expr.slice(0, -1);
    else if (k === '=') { try { this.out = String(evaluate(this.expr || '0')); } catch { this.out = 'Error'; } }
    else if (k === 'x²') this.expr += '²';
    else if (k === '±') this.expr = this.expr.startsWith('-') ? this.expr.slice(1) : `-${this.expr}`;
    else if (['sin', 'cos', 'tan', '√', 'ln'].includes(k)) this.expr += `${k}(`;
    else this.expr += k;
    this.render();
  }

  render() {
    this.root.querySelector('#calc-expr').textContent = this.expr;
    this.root.querySelector('#calc-out').textContent = this.out;
  }
}

export { evaluate };
