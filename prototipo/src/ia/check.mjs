// Conferência das partes puras da IA (sem modelo): node prototipo/src/ia/check.mjs
import assert from 'node:assert/strict';
import { evaluate, formatResult } from './calculo.js';
import { ungroundedNumbers } from './conferencia.js';
import { createFactSearch } from './busca.js';

// Calculadora: contas certas e nada além de aritmética.
assert.equal(formatResult(evaluate('4,7 - 2,4')), '2,3');
assert.equal(evaluate('(71 - 10) / 12.5'), 4.88);
assert.equal(evaluate('-3 * (2 + 1)'), -9);
assert.equal(evaluate('2 × 3 ÷ 4'), 1.5);
for (const bad of ['1/0', 'alert(1)', '2 +', '', '(1 + 2']) assert.throws(() => evaluate(bad), `recusa "${bad}"`);

// Ordem direta: pergunta não é ordem, nem quando vem da voz, sem ponto de interrogação.
{
  const { isOrder } = await import('./ferramentas-comuns.js');
  for (const order of ['Pausa a caminhada.', 'registra uma amostra de arenito', 'abortar', 'muda a hora para as 8h']) assert.ok(isOrder(order), `ordem: "${order}"`);
  for (const question of ['Devo pausar a caminhada?', 'devo abortar', 'posso pausar a caminhada', 'será que dá para voltar', 'como registro uma amostra', 'é pra abortar']) assert.ok(!isOrder(question), `pergunta: "${question}"`);
}

// Trava de números: aceita o que veio das ferramentas (igual ou arredondado) e barra o resto.
const data = [JSON.stringify({ caminhada: '1h24', distancia_km: 2.94, o2: 51.6, por: '17:56', dose: '1.080 µSv', lat: -4.76135 })];
assert.deepEqual(ungroundedNumbers('Volta em 1h24, 2,9 km, chega com 52% de O₂. Pôr do Sol às 17:56.', data), []);
assert.deepEqual(ungroundedNumbers('Volta em 1 hora e 24 minutos.', data), []);
assert.deepEqual(ungroundedNumbers('Volta em 1h40.', data), ['40'], 'conversão errada de 1,4 h é barrada');
assert.deepEqual(ungroundedNumbers('Dose de 1.080 µSv; latitude -4,761.', data), []);
assert.deepEqual(ungroundedNumbers('O₂ em 5%.', data), ['5'], 'latitude não vira porcentagem');
assert.deepEqual(ungroundedNumbers('Faltam 3 paradas e o passo 2 de 4.', data), [], 'contagens pequenas passam');
assert.deepEqual(ungroundedNumbers('A temperatura é de -63 °C.', data), ['63']);
assert.deepEqual(ungroundedNumbers('São 300 metros.', ['a 300 m']), []);
assert.deepEqual(ungroundedNumbers('Em 2024 o RAD mediu 8.100 microgray.', ['evento de 20/05/2024: 8.100 microgray']), []);

// Busca nas fontes: acha o fato certo, com o link, e não inventa quando não há nada.
const search = createFactSearch();
// O fato devolvido traz o tema e o texto; a IA lê os dois.
const top = (query) => { const [first] = search(query); return { ...first, texto: `${first.tema}: ${first.texto}` }; };
assert.match(top('evento solar de 2024 radiação').texto, /8\.100/);
assert.ok(top('evento solar de 2024 radiação').fontes.length > 0, 'fato vem com fonte');
assert.match(top('de onde vem a temperatura').texto, /REMS/);
assert.match(top('enxofre puro gediz vallis').texto, /enxofre/i);
assert.match(top('o que fazer em tempestade de poeira').texto, /poeira/i);
assert.match(top('rodas do curiosity furadas').texto, /roda/i);
assert.deepEqual(search('receita de bolo de chocolate'), [], 'assunto fora da missão não acha nada');
assert.ok(search('radiação').length <= 5);

process.stdout.write('ok: calculadora, trava de números e busca nas fontes\n');
