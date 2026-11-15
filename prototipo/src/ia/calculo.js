// Calculadora da IA: soma, subtração, multiplicação, divisão e parênteses, sem `eval`.
// O modelo de linguagem erra conta de cabeça; aqui a conta é feita de verdade. Puro.

import { IS_ENGLISH } from '../i18n.js';

// Em inglês a vírgula separa milhares ("1,080"); em português ela é a vírgula decimal ("4,7").
const TOKEN = IS_ENGLISH
  ? /\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[-+*/()×÷x])/y
  : /\s*(\d+(?:[.,]\d+)?|[-+*/()×÷x])/y;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

function tokenize(expression) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  const text = String(expression ?? '').trim();
  while (TOKEN.lastIndex < text.length) {
    const match = TOKEN.exec(text);
    if (!match) throw new Error('Expressão inválida: use só números e + - * / ( ).');
    tokens.push(match[1]);
  }
  if (tokens.length === 0) throw new Error('Expressão vazia.');
  return tokens;
}

/** @returns {number} Valor da expressão. Lança erro se ela for inválida ou dividir por zero. */
export function evaluate(expression) {
  const tokens = tokenize(expression);
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];

  function factor() {
    const token = take();
    if (token === '-') return -factor();
    if (token === '+') return factor();
    if (token === '(') {
      const value = sum();
      if (take() !== ')') throw new Error('Falta fechar um parêntese.');
      return value;
    }
    const text = String(token);
    const value = Number.parseFloat(IS_ENGLISH && THOUSANDS.test(text) ? text.replace(/,/g, '') : text.replace(',', '.'));
    if (!Number.isFinite(value)) throw new Error('Expressão inválida.');
    return value;
  }
  function product() {
    let value = factor();
    while (['*', '/', '×', '÷', 'x'].includes(peek())) {
      const operator = take();
      const right = factor();
      if (operator === '/' || operator === '÷') {
        if (right === 0) throw new Error('Divisão por zero.');
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  }
  function sum() {
    let value = product();
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + product() : value - product();
    return value;
  }

  const result = sum();
  if (at < tokens.length) throw new Error('Expressão inválida.');
  return result;
}

/** Resultado em texto, com até duas casas: vírgula decimal em português, ponto em inglês. */
export const formatResult = (value) => {
  const text = String(Math.round(value * 100) / 100);
  return IS_ENGLISH ? text : text.replace('.', ',');
};
