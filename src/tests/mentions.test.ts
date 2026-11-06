import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replaceMentions, shortName } from '../services/mentions.js';

describe('mentions — "@<id>" traducido a nombres reales', () => {
  const contacts: Record<string, string> = {
    '100000000000001': 'Alejandro Páez',
    '59170000000': 'Nicol',
  };
  const lookup = (id: string) => contacts[id];

  test('traduce una mención por lid al nombre real', () => {
    const result = replaceMentions('che @100000000000001 decile que venga', lookup);

    assert.equal(result.text, 'che alejandro decile que venga');
    assert.equal(result.replaced, 1);
  });

  test('traduce varias menciones en un mismo mensaje', () => {
    const result = replaceMentions('@100000000000001 y @59170000000 juegan?', lookup);

    assert.equal(result.text, 'alejandro y nicol juegan?');
    assert.equal(result.replaced, 2);
  });

  test('traduce la mención aunque esté al final sin espacio', () => {
    const result = replaceMentions('quien es @100000000000001', lookup);

    assert.equal(result.text, 'quien es alejandro');
    assert.equal(result.replaced, 1);
  });

  test('deja la mención intacta si no hay nombre conocido', () => {
    const result = replaceMentions('y ese @123456789012345 quien es', lookup);

    assert.equal(result.text, 'y ese @123456789012345 quien es');
    assert.equal(result.replaced, 0);
  });

  test('no toca los textos sin menciones', () => {
    const result = replaceMentions('hola que haces', lookup);

    assert.equal(result.text, 'hola que haces');
    assert.equal(result.replaced, 0);
  });

  test('un lookup que explota no rompe el texto', () => {
    const result = replaceMentions('che @100000000000001', () => {
      throw new Error('boom');
    });

    assert.equal(result.text, 'che @100000000000001');
    assert.equal(result.replaced, 0);
  });

  test('shortName acorta el nombre y descarta números', () => {
    assert.equal(shortName('Alejandro Páez'), 'alejandro');
    assert.equal(shortName('  César  '), 'césar');
    assert.equal(shortName('+59170000000'), undefined);
    assert.equal(shortName(''), undefined);
    assert.equal(shortName(undefined), undefined);
  });
});
